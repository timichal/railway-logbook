/**
 * The logbook: trips and standalone journeys, newest first — the web app's
 * `JourneysAndTripsTab`.
 *
 * **The page is the server's**, ordered and hydrated by `GET /logbook` (a trip's
 * date is the latest of its journeys', which no client could work out from one
 * page), so nothing here re-sorts or re-filters what it is handed. Search and
 * paging go back to the server; the search is debounced, as on the web.
 *
 * One card is open at a time, for the reason the web app opens one: an open card
 * points the map at its routes, and two open cards would be two claims about what
 * the map is showing. Since the map is a *different tab* here, opening a card sets
 * the highlight and says so — the reader goes to the map to see it.
 */
import { Ionicons } from "@expo/vector-icons";
import { getUntimezonedDateStr } from "@shared/getUntimezonedDateStr";
import { useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import * as api from "@/api/endpoints";
import { useHighlight } from "@/logbook/HighlightContext";
import { useLogVersion } from "@/logbook/logVersion";
import { useRegion } from "@/region/RegionContext";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

export default function LogbookScreen(): ReactNode {
  const { regionId } = useRegion();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<api.LogbookPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // A journey logged from the map lands in this list, so its version is one of the
  // list's inputs rather than something a focus event has to notice.
  const logVersion = useLogVersion();
  const [openKey, setOpenKey] = useState<string | null>(null);

  // Typing is not a request. The debounce also resets the page, because a new
  // search's page 3 is a page of a different list.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey and logVersion are intentional triggers — a retry and a newly logged journey both mean this page is stale.
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    api
      .logbook(regionId, { page, pageSize: PAGE_SIZE, search: query }, controller.signal)
      .then(setData)
      .catch((caught: unknown) => {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Could not load the logbook.");
      });
    return () => controller.abort();
  }, [regionId, page, query, reloadKey, logVersion]);

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Screen edges={["top"]}>
      <View className="gap-3 px-4 pb-3 pt-2">
        <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">Logbook</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search trips and journeys"
          placeholderTextColor="#9ca3af"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          className="min-h-11 rounded-xl border border-gray-300 bg-white px-3 text-base text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </View>

      {error ? (
        <View className="gap-3 p-4">
          <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text>
          <Button label="Try again" onPress={() => setReloadKey((key) => key + 1)} />
        </View>
      ) : data === null ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={data.items}
          keyExtractor={itemKey}
          contentContainerClassName="gap-3 px-4 pb-6"
          ListEmptyComponent={
            <Text className="pt-8 text-center text-sm text-gray-600 dark:text-gray-400">
              {query
                ? "Nothing matches that."
                : "Nothing logged in this region yet. Pick routes on the map to start."}
            </Text>
          }
          ListFooterComponent={
            lastPage > 1 ? (
              <View className="flex-row items-center justify-between gap-3 pt-4">
                <Button
                  label="Previous"
                  variant="outline"
                  disabled={page <= 1}
                  onPress={() => setPage((p) => Math.max(1, p - 1))}
                />
                <Text className="text-sm text-gray-600 dark:text-gray-400">
                  {page} / {lastPage}
                </Text>
                <Button
                  label="Next"
                  variant="outline"
                  disabled={page >= lastPage}
                  onPress={() => setPage((p) => Math.min(lastPage, p + 1))}
                />
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const key = itemKey(item);
            return (
              <LogbookCard
                item={item}
                open={openKey === key}
                onToggle={() => setOpenKey(openKey === key ? null : key)}
              />
            );
          }}
        />
      )}
    </Screen>
  );
}

function itemKey(item: api.LogbookItem): string {
  return item.type === "trip" ? `trip-${item.trip.id}` : `journey-${item.journey.id}`;
}

function LogbookCard({
  item,
  open,
  onToggle,
}: {
  item: api.LogbookItem;
  open: boolean;
  onToggle(): void;
}): ReactNode {
  return item.type === "trip" ? (
    <TripCard trip={item.trip} journeys={item.journeys} open={open} onToggle={onToggle} />
  ) : (
    <JourneyCard journey={item.journey} open={open} onToggle={onToggle} />
  );
}

function TripCard({
  trip,
  journeys,
  open,
  onToggle,
}: {
  trip: api.TripWithStats;
  journeys: api.JourneyWithStats[];
  open: boolean;
  onToggle(): void;
}): ReactNode {
  return (
    <View className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      <CardHeader
        icon="briefcase-outline"
        title={trip.name}
        subtitle={dateRange(trip.start_date, trip.end_date)}
        stats={`${trip.journey_count} ${plural(trip.journey_count, "journey", "journeys")} · ${trip.route_count} ${plural(trip.route_count, "route", "routes")} · ${formatKm(trip.total_distance)} km`}
        open={open}
        onToggle={onToggle}
      />
      {open ? (
        <View className="gap-2 border-t border-gray-200 p-3 dark:border-gray-700">
          {/* Opening the trip points the map at every route across its journeys. */}
          <ShowOnMap kind="trip" id={trip.id} label="Show the whole trip on the map" />
          {trip.description ? (
            <Text className="text-sm text-gray-700 dark:text-gray-300">{trip.description}</Text>
          ) : null}
          {journeys.map((journey) => (
            <View key={journey.id} className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
              <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {journey.name}
              </Text>
              <Text className="text-xs text-gray-600 dark:text-gray-400">
                {formatDate(journey.date)} · {journey.route_count}{" "}
                {plural(journey.route_count, "route", "routes")} ·{" "}
                {formatKm(journey.total_distance)} km
              </Text>
              <ShowOnMap kind="journey" id={journey.id} label="Show on the map" />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function JourneyCard({
  journey,
  open,
  onToggle,
}: {
  journey: api.JourneyWithStats;
  open: boolean;
  onToggle(): void;
}): ReactNode {
  return (
    <View className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      <CardHeader
        icon="train-outline"
        title={journey.name}
        subtitle={formatDate(journey.date)}
        stats={`${journey.route_count} ${plural(journey.route_count, "route", "routes")} · ${formatKm(journey.total_distance)} km`}
        open={open}
        onToggle={onToggle}
      />
      {open ? (
        <View className="gap-2 border-t border-gray-200 p-3 dark:border-gray-700">
          {journey.description ? (
            <Text className="text-sm text-gray-700 dark:text-gray-300">{journey.description}</Text>
          ) : null}
          <ShowOnMap kind="journey" id={journey.id} label="Show on the map" />
        </View>
      ) : null}
    </View>
  );
}

function CardHeader({
  icon,
  title,
  subtitle,
  stats,
  open,
  onToggle,
}: {
  icon: "briefcase-outline" | "train-outline";
  title: string;
  subtitle: string;
  stats: string;
  open: boolean;
  onToggle(): void;
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={title}
      onPress={onToggle}
      className="min-h-14 flex-row items-center gap-3 bg-white p-3 active:opacity-70 dark:bg-gray-900"
    >
      <Ionicons name={icon} size={20} color="#6b7280" />
      <View className="flex-1">
        <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</Text>
        <Text className="text-xs text-gray-600 dark:text-gray-400">{subtitle}</Text>
        <Text className="text-xs text-gray-500 dark:text-gray-500">{stats}</Text>
      </View>
      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color="#6b7280" />
    </Pressable>
  );
}

/**
 * Point the map at this trip's or journey's routes, and take the reader there.
 *
 * The routes are fetched on the press rather than carried in the list: the logbook
 * page would otherwise ship every track id of every row to draw a button nobody has
 * pressed yet.
 */
function ShowOnMap({
  kind,
  id,
  label,
}: {
  kind: "trip" | "journey";
  id: number;
  label: string;
}): ReactNode {
  const router = useRouter();
  const { highlight, ownerKey } = useHighlight();
  const [busy, setBusy] = useState(false);
  // The map may already be showing this one — from a previous press, or from before
  // the reader came back to this tab. Saying so beats offering the same press twice.
  const showing = ownerKey === `${kind}-${id}`;

  const show = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const trackIds =
        kind === "trip"
          ? (await api.trip(id)).routeIds
          : (await api.journey(id)).routes.map((route) => route.track_id);
      highlight({ trackIds, kind: "view", ownerKey: `${kind}-${id}` });
      router.push("/(tabs)/map");
    } finally {
      setBusy(false);
    }
  }, [kind, id, highlight, router]);

  return (
    <Button
      label={showing ? "Showing on the map" : label}
      variant={showing ? "secondary" : "outline"}
      busy={busy}
      onPress={() => (showing ? router.push("/(tabs)/map") : void show())}
    />
  );
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** A Postgres numeric arrives as a string; an absent one as null. */
function formatKm(value: string | null): string {
  return (Number(value) || 0).toFixed(1);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("cs-CZ").format(new Date(getUntimezonedDateStr(value)));
}

function dateRange(start: string | null, end: string | null): string {
  if (!start || !end) return "No journeys yet";
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
}
