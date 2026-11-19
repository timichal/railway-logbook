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
 */
import { type JourneyChain, journeyChains } from "@shared/journeyChains";
import { routeTitle } from "@shared/map/routeFeature";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import * as api from "@/api/endpoints";
import { useLogVersion } from "@/logbook/logVersion";
import { ShowOnMap } from "@/logbook/ShowOnMap";
import { useRegion } from "@/region/RegionContext";
import { Button } from "@/ui/Button";

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt and logVersion are intentional triggers — a retry, and a log that may have changed.
  useEffect(() => {
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
  const chains = useMemo(() => (routes ? journeyChains(routes) : []), [routes]);

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
          {chains.map((chain) => (
            <ChainRow key={chain.trackIds[0]} chain={chain} />
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
      <ShowOnMap
        ownerKey={`journey-${journeyId}`}
        label="Show on the map"
        load={async () => ({
          trackIds: journey.routes.map((route) => route.track_id),
          partials: journey.partials,
          bounds: journey.bounds,
        })}
      />
    </View>
  );
}

/** Spaces that don't break, so a line wraps between stations rather than inside one. */
const keepWhole = (name: string) => name.replace(/ /g, " ");

/**
 * One line of stations. "…" marks an end the ride didn't reach: it began or ended
 * partway along the route, between that stop and the next.
 */
function ChainRow({ chain }: { chain: JourneyChain }): ReactNode {
  const { stops, startsPartway, endsPartway } = chain;
  const last = stops.length - 1;
  const spoken = [
    stops.join(", "),
    startsPartway ? `boarded between ${stops[0]} and ${stops[1]}` : null,
    endsPartway ? `left the train between ${stops[last - 1]} and ${stops[last]}` : null,
    `${chain.lengthKm.toFixed(1)} kilometres`,
    chain.unknownExtent ? "includes a route ridden only in part, counted whole" : null,
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
      <Text className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
        {chain.lengthKm.toFixed(1)} km
        {chain.unknownExtent ? (
          <Text className="text-amber-700 dark:text-amber-400"> · partial</Text>
        ) : null}
      </Text>
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
  return (
    <View className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
      <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">
        {name ?? endpoints}
      </Text>
      {name ? <Text className="text-xs text-gray-600 dark:text-gray-400">{endpoints}</Text> : null}
      {route.length_km != null ? <RouteLength route={route} /> : null}
    </View>
  );
}

/**
 * The whole line's length, unless the ride was partial: then the stretch travelled
 * where it is known, and otherwise only that it was part of the line — a partial ride
 * ticked by hand says a piece was ridden without saying which.
 */
function RouteLength({ route }: { route: api.LoggedRoute }): ReactNode {
  const length = Number(route.length_km);
  const whole = `${length.toFixed(1)} km`;
  const { partial, covered_start: start, covered_end: end } = route;
  const known = partial && start != null && end != null;
  return (
    <Text className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
      {!partial ? whole : known ? `${(Math.abs(end - start) * length).toFixed(1)} km ` : null}
      {partial ? (
        <Text className="text-amber-700 dark:text-amber-400">
          {known ? `(partial, of ${whole})` : `partial, of ${whole}`}
        </Text>
      ) : null}
    </Text>
  );
}
