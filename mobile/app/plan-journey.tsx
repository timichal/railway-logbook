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
 * the routes searched — so it is rendered beside the form rather than caught.
 *
 * **Special routes are searched only where the region counts them** (`ordinaryUsageTypes`):
 * in Japan they are the non-JR operators' lines, behind a switch that starts on, as
 * the web planner's does. Europe's are irregular services and never searched.
 *
 * **A found path highlights the map immediately**, before anything is added to the
 * selection. On the web the planner sits in a sidebar next to the map and the gold
 * line appears in the same glance; here the modal is over the map, so the highlight
 * is waiting underneath when this screen is dismissed, and the map's own chip says
 * what it is showing. Adding the routes to the selection hands them to the orange
 * selection highlight and drops the gold one, which is the web's behaviour too — two
 * colours claiming to be the answer is one too many.
 *
 * **The form and the answer are not this screen's** (`PlannerContext`): closing the
 * modal to look at the path must not throw either away, or adding it would mean
 * planning it twice. Only the add in flight is local.
 */

import { Ionicons } from "@expo/vector-icons";
import { hasOrdinaryNonRegular, regionUsagePluralLabel } from "@shared/regions";
import type { PlannerRoute, Station } from "@shared/types";
import { useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import * as api from "@/api/endpoints";
import { usePlanner } from "@/logbook/PlannerContext";
import { useSelection } from "@/logbook/SelectionContext";
import { routeFeatureFromMetadata } from "@/map/mapFeatures";
import { useRegion } from "@/region/RegionContext";
import { StationField } from "@/stations/StationField";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { ToggleSwitch } from "@/ui/ToggleSwitch";

export default function PlanJourneyScreen(): ReactNode {
  const router = useRouter();
  const { add } = useSelection();
  const { regionId } = useRegion();
  const { form, result, error, searching, editForm, find, showOnMap, reset } = usePlanner();
  const { from, to, vias, includeSpecial } = form;
  const offersSpecial = hasOrdinaryNonRegular(regionId);

  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // An answer kept from an earlier visit is drawn again, in case the map has been
  // pointed at something else (or its chip dismissed) since
  // biome-ignore lint/correctness/useExhaustiveDependencies: on opening only — showOnMap changes with every answer, and a fresh answer highlights itself.
  useEffect(() => {
    showOnMap();
  }, []);

  const setVia = (index: number, station: Station | null): void => {
    editForm((f) => ({ ...f, vias: f.vias.map((s, i) => (i === index ? station : s)) }));
  };

  const moveVia = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= vias.length) return;
    editForm((f) => {
      const next = [...f.vias];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...f, vias: next };
    });
  };

  const addToSelection = useCallback(async (): Promise<void> => {
    if (!result) return;
    setAdding(true);
    setAddError(null);
    try {
      // The plan names its routes by endpoint; the selection holds whole features, so
      // the ids are exchanged for the route rows the tile would have carried.
      const metadata = await api.routeMetadata(result.routes.map((r) => r.track_id));
      const byId = new Map(metadata.map((route) => [route.track_id, route]));

      for (const planned of result.routes) {
        const row = byId.get(planned.track_id);
        if (!row) continue;
        add(routeFeatureFromMetadata(row), {
          partial: planned.partial !== undefined,
          covered: planned.partial,
        });
      }

      // The plan is spent, as on the web: the selection's own orange highlight takes
      // over from the gold one, which goes with the answer
      reset();
      router.back();
    } catch (caught) {
      setAddError(caught instanceof Error ? caught.message : "Could not add those routes.");
      setAdding(false);
    }
  }, [result, add, reset, router]);

  const shownError = addError ?? error;
  const hasForm = from !== null || to !== null || vias.length > 0;

  return (
    <Screen>
      {/* Not a KeyboardAvoidingView: it measures itself against its parent, not the
          screen, and a modal sheet starts below the top of the screen — so it came up
          short by that much, and the keyboard's suggestion bar covered the bottom of
          the form. The scroll view's own iOS inset is measured by UIKit in window
          coordinates; Android resizes the window for the keyboard itself. */}
      <View className="flex-1">
        <View className="flex-row items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Text className="text-lg font-bold text-gray-900 dark:text-gray-100">
            Journey planner
          </Text>
          <View className="flex-row">
            {hasForm ? <Button label="Clear" variant="ghost" onPress={reset} /> : null}
            <Button label="Close" variant="ghost" onPress={() => router.back()} />
          </View>
        </View>

        <ScrollView
          contentContainerClassName="gap-4 p-4"
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <StationField
            label="From"
            placeholder="Search for a station"
            value={from}
            onChange={(station) => editForm((f) => ({ ...f, from: station }))}
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
                  onChange={(picked) => setVia(index, picked)}
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
                onPress={() =>
                  editForm((f) => ({ ...f, vias: f.vias.filter((_, i) => i !== index) }))
                }
              />
            </View>
          ))}

          <Button
            label="+ Add via station"
            variant="outline"
            onPress={() => editForm((f) => ({ ...f, vias: [...f.vias, null] }))}
          />

          <StationField
            label="To"
            placeholder="Search for a station"
            value={to}
            onChange={(station) => editForm((f) => ({ ...f, to: station }))}
          />

          {offersSpecial ? (
            <ToggleSwitch
              label={`Include ${regionUsagePluralLabel(regionId, 2)}`}
              value={includeSpecial}
              onChange={(value) => editForm((f) => ({ ...f, includeSpecial: value }))}
            />
          ) : null}

          <Button
            label="Find path"
            onPress={() => void find()}
            busy={searching}
            disabled={!from || !to}
          />

          {shownError ? (
            <View className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
              <Text className="text-sm text-red-700 dark:text-red-300">{shownError}</Text>
            </View>
          ) : null}

          {result && result.routes.length > 0 ? (
            <View className="gap-3">
              <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {result.routes.length} {result.routes.length === 1 ? "route" : "routes"} ·{" "}
                {result.totalDistance.toFixed(1)} km
              </Text>
              <View className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                {result.routes.map((route, index) => (
                  <PlannedRouteRow key={route.track_id} route={route} index={index} />
                ))}
              </View>
              <Button
                label="Add routes to selection"
                onPress={() => void addToSelection()}
                busy={adding}
              />
              <Text className="text-xs text-gray-500 dark:text-gray-400">
                The path is drawn in gold on the map — close this to look at it. It stays here until
                you add it, clear it or change the stations.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
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
