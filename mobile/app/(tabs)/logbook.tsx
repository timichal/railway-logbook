/**
 * The logbook: trips and standalone journeys, newest first — the web app's
 * `JourneysAndTripsTab`.
 *
 * **The page is the server's**, ordered and hydrated by `GET /logbook` (a trip's
 * date is the latest of its journeys', which no client could work out from one
 * page), so nothing here re-sorts or re-filters what it is handed. Search and
 * paging go back to the server; the search is debounced, as on the web. Paging is
 * an endless scroll rather than the web's Previous/Next (`Logbook`).
 *
 * One card is open at a time, as on the web. There an open card points the map at
 * its routes; here the map is a *different tab*, so opening a card only shows what is
 * in it. A trip's "Show on the map" sets the highlight and takes the reader there
 * (`ShowOnMap`); a journey's "Open on the map" opens it there as the selection, to
 * look at or edit (`JourneyDetails`).
 *
 * An open journey shows the lines of stations it rode (`JourneyDetails`), read when
 * it opens; the journeys inside an open trip open the same way, one at a time.
 */
import { Ionicons } from "@expo/vector-icons";
import { SEARCH_DEBOUNCE_MS } from "@shared/constants";
import { formatDateOnly, formatDateOnlyRange } from "@shared/getUntimezonedDateStr";
import type { RegionId } from "@shared/regions";
import { useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, Text, TextInput, View } from "react-native";
import * as api from "@/api/endpoints";
import { JourneyDetails } from "@/logbook/JourneyDetails";
import { bumpLogVersion, useLogVersion } from "@/logbook/logVersion";
import { useSelection } from "@/logbook/SelectionContext";
import { ShowOnMap } from "@/logbook/ShowOnMap";
import { useRegion } from "@/region/RegionContext";
import { useNativeColors } from "@/theme/colors";
import { Button } from "@/ui/Button";
import { formatKm } from "@/ui/format";
import { Screen } from "@/ui/Screen";

/** Loaded at a time, as the list nears its end. */
const PAGE_SIZE = 20;
/** The server's cap on `pageSize`: a refresh reloads at most this many in one read. */
const MAX_PAGE_SIZE = 100;

/** The list as loaded so far: the first `pages` pages of the search `query`. */
interface LoadedList {
  items: api.LogbookItem[];
  total: number;
  pages: number;
  query: string;
}

/**
 * Keyed by region: a switch starts the list over — search, loaded pages and open
 * card — since nothing loaded for Europe belongs to Japan's list.
 */
export default function LogbookScreen(): ReactNode {
  const { regionId } = useRegion();
  return <Logbook key={regionId} regionId={regionId} />;
}

/**
 * Scrolls without end: the next page is read as the list nears its bottom
 * (`onEndReached`). Pulling down re-reads the log (`bumpLogVersion`, so the map's
 * colours and numbers come along with the list). A re-read — a pull, a write, a
 * return to the app — reloads as much as was shown in one request (to the server's
 * cap), so the reader keeps their place; a new search starts at the top. A re-read
 * that fails keeps the list shown and says so above it; only a list never loaded
 * becomes an error screen.
 *
 * Pages are by offset, so the two kinds of load are kept from crossing: no next
 * page is asked for while a reload is out (it would be the old search's, or be
 * thrown away by the reload landing), a reload drops any page still out, and a
 * page whose `total` differs from the list's means rows were added or removed
 * meanwhile (on the web, say) and every offset has moved: the list is reloaded
 * rather than the page appended, which would skip or repeat a row.
 */
function Logbook({ regionId }: { regionId: RegionId }): ReactNode {
  const colors = useNativeColors();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [list, setList] = useState<LoadedList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // A journey logged from the map lands in this list, so its version is one of the
  // list's inputs rather than something a focus event has to notice.
  const logVersion = useLogVersion();
  const [openKey, setOpenKey] = useState<string | null>(null);

  // Read by the loads, which must not be rebuilt whenever the list grows
  const listRef = useRef(list);
  listRef.current = list;
  /** Bumped by every reload: a page landing for an older one is dropped. */
  const generation = useRef(0);
  const loadingMoreRef = useRef(false);
  /** A reload is out: no next page until it lands. */
  const reloading = useRef(false);

  // Typing is not a request
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey and logVersion are intentional triggers — a retry, a pull and a newly logged journey all mean the list is stale.
  useEffect(() => {
    const own = ++generation.current;
    const controller = new AbortController();
    const shown = listRef.current;
    // The same search keeps as many pages as were loaded; a new one starts over
    const pages =
      shown && shown.query === query ? Math.min(shown.pages, MAX_PAGE_SIZE / PAGE_SIZE) : 1;
    setError(null);
    // Said of the search on screen; a new one answers for itself
    if (shown?.query !== query) setRefreshError(null);
    reloading.current = true;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setMoreError(null);
    api
      .logbook(regionId, { page: 1, pageSize: pages * PAGE_SIZE, search: query }, controller.signal)
      .then((next) => {
        if (own !== generation.current) return;
        setRefreshError(null);
        setList({ items: next.items, total: next.total, pages, query });
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || own !== generation.current) return;
        const message = caught instanceof Error ? caught.message : "Could not load the logbook.";
        // The list on screen answers this same search: keep it
        if (listRef.current?.query === query) {
          setRefreshError(message);
        } else {
          setRefreshError(null);
          setError(message);
        }
      })
      .finally(() => {
        if (own !== generation.current) return;
        reloading.current = false;
        setRefreshing(false);
      });
    return () => controller.abort();
  }, [regionId, query, reloadKey, logVersion]);

  const loadMore = useCallback((): void => {
    const shown = listRef.current;
    if (
      !shown ||
      reloading.current ||
      loadingMoreRef.current ||
      shown.items.length >= shown.total
    ) {
      return;
    }
    const own = generation.current;
    const page = shown.pages + 1;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreError(null);
    api
      .logbook(regionId, { page, pageSize: PAGE_SIZE, search: shown.query })
      .then((next) => {
        if (own !== generation.current) return;
        const items = appendNew(shown.items, next.items);
        // Rows added or removed since the list loaded: every offset has moved
        if (next.total !== shown.total || items.length !== shown.items.length + next.items.length) {
          setReloadKey((key) => key + 1);
          return;
        }
        setList({ ...shown, items, pages: page });
      })
      .catch((caught: unknown) => {
        if (own !== generation.current) return;
        setMoreError(caught instanceof Error ? caught.message : "Could not load more.");
      })
      .finally(() => {
        if (own !== generation.current) return;
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [regionId]);

  return (
    <Screen edges={["top"]}>
      <View className="gap-3 px-4 pb-3 pt-2">
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">Logbook</Text>
          <Button label="New trip" variant="ghost" onPress={() => router.push("/edit-trip")} />
        </View>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search trips and journeys"
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          className="min-h-11 rounded-xl border border-gray-300 bg-white px-3 text-base text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        {refreshError ? (
          <Text className="text-sm text-red-600 dark:text-red-400">
            Couldn’t refresh: {refreshError}
          </Text>
        ) : null}
      </View>

      {error ? (
        <View className="gap-3 p-4">
          <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text>
          <Button label="Try again" onPress={() => setReloadKey((key) => key + 1)} />
        </View>
      ) : list === null ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={list.items}
          keyExtractor={itemKey}
          contentContainerClassName="gap-3 px-4 pb-6"
          keyboardDismissMode="on-drag"
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            bumpLogVersion();
          }}
          // Not after a failure: that waits for "Try again", rather than retrying as
          // fast as the list can scroll
          onEndReached={moreError ? undefined : loadMore}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            <Text className="pt-8 text-center text-sm text-gray-600 dark:text-gray-400">
              {list.query
                ? "Nothing matches that."
                : "Nothing logged in this region yet. Pick routes on the map to start."}
            </Text>
          }
          ListFooterComponent={
            moreError ? (
              <View className="gap-2 pt-2">
                <Text className="text-sm text-red-600 dark:text-red-400">{moreError}</Text>
                <Button label="Try again" variant="outline" onPress={loadMore} />
              </View>
            ) : loadingMore ? (
              <View className="items-center pt-2">
                <ActivityIndicator />
              </View>
            ) : undefined
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

/** `next` after `items`, less any row `items` already has. */
function appendNew(items: api.LogbookItem[], next: api.LogbookItem[]): api.LogbookItem[] {
  const seen = new Set(items.map(itemKey));
  return [...items, ...next.filter((item) => !seen.has(itemKey(item)))];
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
      {open ? <TripBody trip={trip} journeys={journeys} /> : null}
    </View>
  );
}

/**
 * An open trip: its journeys, each of which opens in place to show what it rode. One
 * at a time, as the cards themselves; mounted only while the trip is open, so closing
 * the trip closes them too.
 */
function TripBody({
  trip,
  journeys,
}: {
  trip: api.TripWithStats;
  journeys: api.JourneyWithStats[];
}): ReactNode {
  const { regionId } = useRegion();
  const colors = useNativeColors();
  const [openJourney, setOpenJourney] = useState<number | null>(null);

  return (
    <View className="gap-2 border-t border-gray-200 p-3 dark:border-gray-700">
      {/* Opening the trip points the map at every route across its journeys. */}
      <ShowOnMap
        ownerKey={`trip-${trip.id}`}
        label="Show the whole trip on the map"
        load={() =>
          api.trip(trip.id, regionId).then((t) => ({
            trackIds: t.routeIds,
            partials: t.partials,
            bounds: t.bounds,
          }))
        }
      />
      {trip.description ? (
        <Text className="text-sm text-gray-700 dark:text-gray-300">{trip.description}</Text>
      ) : null}
      {journeys.length === 0 ? (
        <Text className="text-sm italic text-gray-600 dark:text-gray-400">
          No journeys yet. Pick this trip when you log or edit one.
        </Text>
      ) : null}
      {journeys.map((journey) => {
        const isOpen = openJourney === journey.id;
        const journeyStats = `${formatDateOnly(journey.date)} · ${journey.route_count} ${plural(journey.route_count, "route", "routes")} · ${formatKm(journey.total_distance)} km`;
        return (
          <View key={journey.id} className="overflow-hidden rounded-lg bg-gray-50 dark:bg-gray-800">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              accessibilityLabel={`${journey.name}, ${journeyStats}`}
              onPress={() => setOpenJourney(isOpen ? null : journey.id)}
              className="min-h-11 flex-row items-center gap-2 p-3 active:opacity-70"
            >
              <View className="flex-1">
                <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {journey.name}
                </Text>
                <Text className="text-xs text-gray-600 dark:text-gray-400">{journeyStats}</Text>
              </View>
              <Ionicons
                name={isOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.icon}
              />
            </Pressable>
            {isOpen ? (
              <View className="gap-2 px-3 pb-3">
                {journey.description ? (
                  <Text className="text-sm text-gray-700 dark:text-gray-300">
                    {journey.description}
                  </Text>
                ) : null}
                <JourneyDetails journeyId={journey.id} />
              </View>
            ) : null}
          </View>
        );
      })}
      <TripActions trip={trip} />
    </View>
  );
}

/** Edit and Delete, at the foot of an open trip. Deleting keeps its journeys, unfiled. */
function TripActions({ trip }: { trip: api.TripWithStats }): ReactNode {
  const router = useRouter();
  const { forgetTrip } = useSelection();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (): Promise<void> => {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteTrip(trip.id);
      forgetTrip(trip.id);
      bumpLogVersion();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the trip.");
      setDeleting(false);
    }
  };

  const askDelete = (): void =>
    Alert.alert(
      `Delete the trip “${trip.name}”?`,
      trip.journey_count > 0
        ? "Its journeys are kept, no longer part of a trip."
        : "It has no journeys.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete trip", style: "destructive", onPress: () => void remove() },
      ],
    );

  return (
    <View className="gap-1 pt-1">
      <View className="flex-row gap-2">
        <Button
          label="Edit trip"
          variant="outline"
          className="flex-1"
          disabled={deleting}
          onPress={() =>
            router.push({
              pathname: "/edit-trip",
              params: {
                id: String(trip.id),
                name: trip.name,
                description: trip.description ?? "",
              },
            })
          }
        />
        <Button
          label="Delete trip"
          variant="outline"
          className="flex-1"
          busy={deleting}
          onPress={askDelete}
        />
      </View>
      {error ? <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text> : null}
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
        subtitle={formatDateOnly(journey.date)}
        stats={`${journey.route_count} ${plural(journey.route_count, "route", "routes")} · ${formatKm(journey.total_distance)} km`}
        open={open}
        onToggle={onToggle}
      />
      {open ? (
        <View className="gap-2 border-t border-gray-200 p-3 dark:border-gray-700">
          {journey.description ? (
            <Text className="text-sm text-gray-700 dark:text-gray-300">{journey.description}</Text>
          ) : null}
          <JourneyDetails journeyId={journey.id} />
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
  const colors = useNativeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      // The label replaces the children's text, so it carries what they show
      accessibilityLabel={`${title}, ${subtitle}, ${stats}`}
      onPress={onToggle}
      className="min-h-14 flex-row items-center gap-3 bg-white p-3 active:opacity-70 dark:bg-gray-900"
    >
      <Ionicons name={icon} size={20} color={colors.icon} />
      <View className="flex-1">
        <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</Text>
        <Text className="text-xs text-gray-600 dark:text-gray-400">{subtitle}</Text>
        <Text className="text-xs text-gray-500 dark:text-gray-500">{stats}</Text>
      </View>
      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.icon} />
    </Pressable>
  );
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
function dateRange(start: string | null, end: string | null): string {
  if (!start || !end) return "No journeys yet";
  return formatDateOnlyRange(start, end);
}
