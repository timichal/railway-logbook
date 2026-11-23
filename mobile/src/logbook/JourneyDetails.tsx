/**
 * An open journey: the lines of stations it rode ("Praha – Beroun – Plzeň", built by
 * `journeyChains` from each route's `ends`), each with the distance travelled along
 * it, then every route on request — the web app's `JourneyCard` body, read-only.
 *
 * Mounted only while its card is open, so the journey is read when it opens and not
 * before (`GET /journeys/:id`). It is read again for a new region (the bounds are the
 * region's) and on the log version, which a sign-in and a return to the app bump, so
 * an edit made on the web shows. A refresh that fails keeps what is shown, as the
 * list does.
 *
 * On the web a chain can be pressed to show it alone on the map. Not here yet: the
 * map fits only to a box the server sends, and the server sends one per journey.
 *
 * "Open on the map" is both looking at a journey and editing it: the two came to the
 * same thing, a trip to the map with the journey on it. The journey as loaded goes
 * into the selection as its edit draft (`SelectionContext`), every highlight is
 * dropped (it would draw over the draft, and go on showing a route the edit removes),
 * and the map flies to it. Looking changes nothing; a route tapped there is added or
 * removed. The selection bar names the journey and opens the logging screen as its
 * editor, for the name, the date and Save, and its × closes the journey, asking only
 * when something changed. Closing is the map's alone: the card here stays "Open on
 * the map" and Delete, and opening another journey closes this one (asking the same
 * way). A trip has no edit on the map, and keeps its orange "Show on the map"
 * (`ShowOnMap`). Delete asks first.
 */
import { type JourneyChain, journeyChains } from "@shared/journeyChains";
import {
  chainClosedBadge,
  closedRowBadge,
  type RouteBadge,
  routeTitle,
} from "@shared/map/routeFeature";
import { useRouter } from "expo-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import * as api from "@/api/endpoints";
import { confirmStopEditing } from "@/logbook/confirmClearSelection";
import { useHighlight } from "@/logbook/HighlightContext";
import { snapshotFromJourney } from "@/logbook/journeyEdit";
import { bumpLogVersion, useLogVersion } from "@/logbook/logVersion";
import { useSelection } from "@/logbook/SelectionContext";
import { useRegion } from "@/region/RegionContext";
import { Button } from "@/ui/Button";
import { formatKm } from "@/ui/format";
import { RouteBadgePill } from "@/ui/RouteBadgePill";

export function JourneyDetails({ journeyId }: { journeyId: number }): ReactNode {
  const { regionId } = useRegion();
  const logVersion = useLogVersion();
  const [attempt, setAttempt] = useState(0);
  // Kept with the inputs it answers, so a region switch never shows the old
  // region's bounds under the new one while the new read is out
  const [loaded, setLoaded] = useState<{ key: string; journey: api.LoadedJourney } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRoutes, setShowRoutes] = useState(false);
  const key = `${regionId}|${journeyId}`;
  const journey = loaded?.key === key ? loaded.journey : null;
  // Deleted here: the log version the delete bumps would otherwise read it again,
  // and show its 404 until the list drops the card
  const deleted = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt and logVersion are intentional triggers — a retry, and a log that may have changed.
  useEffect(() => {
    if (deleted.current) return;
    const controller = new AbortController();
    setError(null);
    api
      .journey(journeyId, regionId, controller.signal)
      .then((next) => setLoaded({ key, journey: next }))
      .catch((caught: unknown) => {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Could not load this journey.");
      });
    return () => controller.abort();
  }, [key, attempt, logVersion]);

  const routes = journey?.routes;
  const chains = useMemo(() => {
    if (!routes) return [];
    return journeyChains(routes).map((chain) => ({
      chain,
      closure: chainClosedBadge(chain.trackIds, routes),
    }));
  }, [routes]);

  if (journey === null) {
    return error ? (
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-sm text-gray-600 dark:text-gray-400">
          Couldn't load this journey. {error}
        </Text>
        <Button label="Retry" variant="outline" onPress={() => setAttempt((n) => n + 1)} />
      </View>
    ) : (
      <View className="items-center py-2">
        <ActivityIndicator accessibilityLabel="Loading the journey" />
      </View>
    );
  }

  return (
    <View className="gap-2">
      {journey.routes.length === 0 ? (
        <Text className="text-sm italic text-gray-600 dark:text-gray-400">
          No routes in this journey.
        </Text>
      ) : (
        <>
          {chains.map(({ chain, closure }) => (
            <ChainRow key={chain.trackIds[0]} chain={chain} closure={closure} />
          ))}
          <Button
            label={
              showRoutes
                ? "Hide routes"
                : `Show all ${journey.routes.length} ${journey.routes.length === 1 ? "route" : "routes"}`
            }
            variant="ghost"
            className="self-start px-1"
            onPress={() => setShowRoutes((shown) => !shown)}
          />
          {showRoutes
            ? journey.routes.map((route) => (
                <RouteRow key={route.track_id} route={route} regionId={regionId} />
              ))
            : null}
        </>
      )}
      <JourneyActions
        journey={journey}
        onDeleted={() => {
          deleted.current = true;
        }}
      />
    </View>
  );
}

/**
 * Open on the map and Delete, under a loaded journey. The open journey's card says
 * when it has unsaved changes, since it shows the journey as saved; Open on it goes
 * back to the edit, and Delete deletes it, edit and all.
 */
function JourneyActions({
  journey,
  onDeleted,
}: {
  journey: api.LoadedJourney;
  /** Before the log version moves, so nothing reads the journey again. */
  onDeleted(): void;
}): ReactNode {
  const router = useRouter();
  const { editing, startEdit, endEdit } = useSelection();
  const { clear: clearHighlight, fitTo } = useHighlight();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { id, name } = journey.journey;
  const editingThis = editing?.journeyId === id;

  // Back to a changed edit, the map is left where it was: this card's box is the
  // journey as saved, and the edit may have routes far outside it
  const toMap = (fit: boolean): void => {
    clearHighlight();
    if (fit && journey.bounds) fitTo(journey.bounds, id);
    router.push("/(tabs)/map");
  };

  const open = (): void => {
    if (editingThis) {
      toMap(!editing.changed);
      return;
    }
    // One journey open at a time: another is closed, asked first if changed
    confirmStopEditing(editing, () => {
      startEdit(id, snapshotFromJourney(journey));
      toMap(true);
    });
  };

  const remove = async (): Promise<void> => {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteJourney(id);
      onDeleted();
      if (editingThis) endEdit();
      // The list reloads without it, and the map drops its colours
      bumpLogVersion();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the journey.");
      setDeleting(false);
    }
  };

  const askDelete = (): void =>
    Alert.alert(`Delete “${name}”?`, "Its routes are unlogged. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void remove() },
    ]);

  return (
    <View className="gap-1">
      <View className="flex-row gap-2">
        <Button
          label="Open on the map"
          variant={editingThis ? "primary" : "outline"}
          className="flex-1"
          disabled={deleting}
          onPress={open}
        />
        <Button
          label="Delete"
          variant="outline"
          className="flex-1"
          busy={deleting}
          onPress={askDelete}
        />
      </View>
      {editingThis && editing.changed ? (
        <Text className="text-sm text-gray-600 dark:text-gray-400">
          Unsaved changes. This card shows the journey as saved.
        </Text>
      ) : null}
      {error ? <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text> : null}
    </View>
  );
}

/** Spaces that don't break, so a line wraps between stations rather than inside one. */
const keepWhole = (name: string) => name.replace(/ /g, " ");

/**
 * One line of stations. "…" marks an end the ride didn't reach: it began or ended
 * partway along the route, between that stop and the next.
 */
function ChainRow({
  chain,
  closure,
}: {
  chain: JourneyChain;
  /** `closedRowBadge` of its routes: null unless one of them is closed. */
  closure: RouteBadge | null;
}): ReactNode {
  const { stops, startsPartway, endsPartway } = chain;
  const last = stops.length - 1;
  const spoken = [
    stops.join(", "),
    startsPartway ? `boarded between ${stops[0]} and ${stops[1]}` : null,
    endsPartway ? `left the train between ${stops[last - 1]} and ${stops[last]}` : null,
    `${formatKm(chain.lengthKm)} kilometres`,
    closure?.label,
  ]
    .filter(Boolean)
    .join("; ");

  return (
    <View
      accessible
      accessibilityLabel={spoken}
      className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
    >
      <Text className="text-sm leading-5 text-gray-900 dark:text-gray-100">
        {stops.map((stop, i) => (
          // Stops repeat (a loop starts and ends at one station), so keyed by place;
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is rebuilt whole and never reordered.
          <Text key={i}>
            {i > 0 ? <Text className="text-gray-400 dark:text-gray-500"> – </Text> : null}
            {i === 0 && startsPartway ? (
              <Text className="text-gray-400 dark:text-gray-500">…</Text>
            ) : null}
            {keepWhole(stop)}
            {i === last && endsPartway ? (
              <Text className="text-gray-400 dark:text-gray-500">…</Text>
            ) : null}
          </Text>
        ))}
      </Text>
      <View className="mt-0.5 flex-row flex-wrap items-center gap-1.5">
        <Text className="text-xs text-gray-600 dark:text-gray-400">
          {formatKm(chain.lengthKm)} km
        </Text>
        {closure ? <RouteBadgePill badge={closure} /> : null}
      </View>
    </View>
  );
}

/** One route of the journey, as the web's `LoggedRouteRow` shows it. */
function RouteRow({
  route,
  regionId,
}: {
  route: api.LoggedRoute;
  regionId: Parameters<typeof routeTitle>[1];
}): ReactNode {
  // A naming region leads with the line name, the endpoints beneath
  const { name, endpoints } = routeTitle(route, regionId);
  const closure = closedRowBadge([route]);
  return (
    <View className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
      <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">
        {name ?? endpoints}
      </Text>
      {name ? <Text className="text-xs text-gray-600 dark:text-gray-400">{endpoints}</Text> : null}
      {route.length_km != null || closure ? (
        <View className="mt-0.5 flex-row flex-wrap items-center gap-1.5">
          {route.length_km != null ? <RouteLength route={route} /> : null}
          {closure ? <RouteBadgePill badge={closure} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The whole line's length, unless the ride was partial: then the stretch travelled,
 * of the whole line. A partial ride always carries its stretch (`loggedRide`).
 */
function RouteLength({ route }: { route: api.LoggedRoute }): ReactNode {
  const length = Number(route.length_km);
  const whole = `${formatKm(length)} km`;
  const { partial, covered_start: start, covered_end: end } = route;
  if (!partial || start == null || end == null) {
    return <Text className="text-xs text-gray-600 dark:text-gray-400">{whole}</Text>;
  }
  return (
    <Text className="text-xs text-gray-600 dark:text-gray-400">
      {`${formatKm(Math.abs(end - start) * length)} km `}
      <Text className="text-amber-700 dark:text-amber-400">(partial, of {whole})</Text>
    </Text>
  );
}
