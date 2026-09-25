/**
 * The Journey Planner — from, any number of vias, to, and the routes between them.
 *
 * A modal over the tabs rather than a tab of its own, for the same reason the logging
 * screen is one: it is a thing you open, spend and close, and what it produces lands
 * somewhere else — on the map as a gold path, and in the selection as routes to log.
 *
 * **The search stays on the server** (`POST /planner`), because it needs Postgres and
 * the in-memory route graph; `API.md` says so and this screen only sends two station
 * ids. "No path found" comes back as a 200 with an `error` string, not as a failure —
 * the request was fine, the network simply doesn't connect those two stations by
 * regular-service routes — so it is rendered beside the form rather than caught.
 *
 * **A found path highlights the map immediately**, before anything is added to the
 * selection. On the web the planner sits in a sidebar next to the map and the gold
 * line appears in the same glance; here the modal is over the map, so the highlight
 * is waiting underneath when this screen is dismissed, and the map's own chip says
 * what it is showing. Adding the routes to the selection hands them to the orange
 * selection highlight and drops the gold one, which is the web's behaviour too — two
 * colours claiming to be the answer is one too many.
 */

import { Ionicons } from "@expo/vector-icons";
import type { PlannerRoute, Station } from "@shared/types";
import { useRouter } from "expo-router";
import { type ReactNode, useCallback, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import * as api from "@/api/endpoints";
import { useHighlight } from "@/logbook/HighlightContext";
import { useSelection } from "@/logbook/SelectionContext";
import { routeFeatureFromMetadata } from "@/map/mapFeatures";
import { StationField } from "@/stations/StationField";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";

/** A station id is `string | number` off the API, and may be negative (see `API.md`). */
function stationId(station: Station): number {
  return typeof station.id === "string" ? Number.parseInt(station.id, 10) : station.id;
}

export default function PlanJourneyScreen(): ReactNode {
  const router = useRouter();
  const { add } = useSelection();
  const { highlight, clear: clearHighlight } = useHighlight();

  const [from, setFrom] = useState<Station | null>(null);
  const [to, setTo] = useState<Station | null>(null);
  // A slot is created empty and filled afterwards, so the list carries nulls — the
  // same positional shape the web app's via rows have.
  const [vias, setVias] = useState<(Station | null)[]>([]);

  const [routes, setRoutes] = useState<PlannerRoute[]>([]);
  const [totalDistance, setTotalDistance] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);

  const setVia = (index: number, station: Station | null): void => {
    setVias((current) => current.map((s, i) => (i === index ? station : s)));
  };

  const moveVia = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    setVias((current) => {
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  /**
   * A new search supersedes whatever the last one put on the map. Stable, because
   * `find` closes over it — a version recreated every render would make that callback
   * useless as one.
   */
  const resetResult = useCallback((): void => {
    setRoutes([]);
    setTotalDistance(0);
    setError(null);
  }, []);

  const find = useCallback(async (): Promise<void> => {
    if (!from || !to) {
      setError("Pick both a from and a to station.");
      return;
    }
    if (vias.some((s) => s === null)) {
      setError("Fill in every via station, or remove the empty ones.");
      return;
    }

    setSearching(true);
    resetResult();
    try {
      const result = await api.plan({
        fromStationId: stationId(from),
        toStationId: stationId(to),
        viaStationIds: vias.flatMap((s) => (s ? [stationId(s)] : [])),
      });

      if (result.error) {
        setError(result.error);
        clearHighlight();
        return;
      }

      setRoutes(result.routes);
      setTotalDistance(result.totalDistance);
      highlight({
        trackIds: result.routes.map((r) => r.track_id),
        kind: "planner",
        // A terminal route joined between its endpoints is highlighted along the
        // stretch travelled only, so the gold line stops at the station.
        partials: result.routes.flatMap((r) => (r.partial ? [r.partial] : [])),
        ownerKey: "planner",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not plan that journey.");
    } finally {
      setSearching(false);
    }
  }, [from, to, vias, highlight, clearHighlight, resetResult]);

  const addToSelection = useCallback(async (): Promise<void> => {
    if (routes.length === 0) return;
    setAdding(true);
    setError(null);
    try {
      // The plan names its routes by endpoint; the selection holds whole features, so
      // the ids are exchanged for the route rows the tile would have carried.
      const metadata = await api.routeMetadata(routes.map((r) => r.track_id));
      const byId = new Map(metadata.map((route) => [route.track_id, route]));

      for (const planned of routes) {
        const row = byId.get(planned.track_id);
        if (!row) continue;
        add(routeFeatureFromMetadata(row), {
          partial: planned.partial !== undefined,
          covered: planned.partial,
        });
      }

      // The selection's own orange highlight takes over from here.
      clearHighlight();
      router.back();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add those routes.");
      setAdding(false);
    }
  }, [routes, add, clearHighlight, router]);

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <View className="flex-row items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Text className="text-lg font-bold text-gray-900 dark:text-gray-100">
            Journey planner
          </Text>
          <Button label="Close" variant="ghost" onPress={() => router.back()} />
        </View>

        <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
          <StationField
            label="From"
            placeholder="Search for a station"
            value={from}
            onChange={(station) => {
              setFrom(station);
              resetResult();
            }}
          />

          {vias.map((station, index) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: a via row is a position in the list — the rows are reordered by swapping their contents, so the index is the row's identity.
              key={index}
              className="flex-row items-end gap-2"
            >
              <View className="flex-1">
                <StationField
                  label={`Via ${index + 1}`}
                  placeholder="Search for a station"
                  value={station}
                  onChange={(picked) => {
                    setVia(index, picked);
                    resetResult();
                  }}
                />
              </View>
              {/* Only worth the width once there are two rows to put in an order. */}
              {vias.length > 1 ? (
                <View className="gap-1">
                  <IconButton
                    icon="chevron-up"
                    label={`Move via ${index + 1} up`}
                    disabled={index === 0}
                    onPress={() => moveVia(index, -1)}
                  />
                  <IconButton
                    icon="chevron-down"
                    label={`Move via ${index + 1} down`}
                    disabled={index === vias.length - 1}
                    onPress={() => moveVia(index, 1)}
                  />
                </View>
              ) : null}
              <IconButton
                icon="trash-outline"
                label={`Remove via ${index + 1}`}
                onPress={() => {
                  setVias((current) => current.filter((_, i) => i !== index));
                  resetResult();
                }}
              />
            </View>
          ))}

          <Button
            label="+ Add via station"
            variant="outline"
            onPress={() => setVias((current) => [...current, null])}
          />

          <StationField
            label="To"
            placeholder="Search for a station"
            value={to}
            onChange={(station) => {
              setTo(station);
              resetResult();
            }}
          />

          <Button
            label="Find path"
            onPress={() => void find()}
            busy={searching}
            disabled={!from || !to}
          />

          {error ? (
            <View className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
              <Text className="text-sm text-red-700 dark:text-red-300">{error}</Text>
            </View>
          ) : null}

          {routes.length > 0 ? (
            <View className="gap-3">
              <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {routes.length} {routes.length === 1 ? "route" : "routes"} ·{" "}
                {totalDistance.toFixed(1)} km
              </Text>
              <View className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                {routes.map((route, index) => (
                  <PlannedRouteRow key={route.track_id} route={route} index={index} />
                ))}
              </View>
              <Button
                label="Add routes to selection"
                onPress={() => void addToSelection()}
                busy={adding}
              />
              <Text className="text-xs text-gray-500 dark:text-gray-400">
                The path is already drawn in gold on the map — close this to look at it.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/**
 * One leg of the plan. The first and last route are trimmed to the stretch actually
 * travelled, so a route joined between its endpoints shows what the plan uses of it
 * against what the whole line is.
 */
function PlannedRouteRow({ route, index }: { route: PlannerRoute; index: number }): ReactNode {
  return (
    <View
      className={`gap-0.5 p-3 ${index === 0 ? "" : "border-t border-gray-200 dark:border-gray-700"}`}
    >
      <Text className="text-sm text-gray-900 dark:text-gray-100">
        {index + 1}. {route.from_station} ⟷ {route.to_station}
      </Text>
      <Text className="text-xs text-gray-600 dark:text-gray-400">
        {route.travelled_length_km.toFixed(1)} km
        {route.partial ? ` · part of ${route.length_km.toFixed(1)} km` : ""}
      </Text>
    </View>
  );
}

function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress(): void;
  disabled?: boolean;
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`h-11 w-11 items-center justify-center rounded-xl border border-gray-300 active:bg-gray-100 dark:border-gray-600 dark:active:bg-gray-800 ${
        disabled ? "opacity-40" : ""
      }`}
    >
      <Ionicons name={icon} size={18} color="#6b7280" />
    </Pressable>
  );
}
