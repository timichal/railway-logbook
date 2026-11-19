/**
 * The logbook: trips and standalone journeys, newest first — the web app's
 * `JourneysAndTripsTab`.
 *
 * **The page is the server's**, ordered and hydrated by `GET /logbook` (a trip's
 * date is the latest of its journeys', which no client could work out from one
 * page), so nothing here re-sorts or re-filters what it is handed. Search and
 * paging go back to the server; the search is debounced, as on the web.
 *
 * One card is open at a time, as on the web. There an open card points the map at
 * its routes; here the map is a *different tab*, so opening a card only shows what is
 * in it, and its "Show on the map" sets the highlight and takes the reader there
 * (`ShowOnMap`).
 *
 * An open journey shows the lines of stations it rode (`JourneyDetails`), read when
 * it opens; the journeys inside an open trip open the same way, one at a time.
 */
import { Ionicons } from "@expo/vector-icons";
import { formatDateOnly, formatDateOnlyRange } from "@shared/getUntimezonedDateStr";
import { useRouter } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, Text, TextInput, View } from "react-native";
import * as api from "@/api/endpoints";
import { JourneyDetails } from "@/logbook/JourneyDetails";
import { bumpLogVersion, useLogVersion } from "@/logbook/logVersion";
import { useSelection } from "@/logbook/SelectionContext";
import { ShowOnMap } from "@/logbook/ShowOnMap";
import { useRegion } from "@/region/RegionContext";
import { useNativeColors } from "@/theme/colors";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

export default function LogbookScreen(): ReactNode {
  const colors = useNativeColors();
  const router = useRouter();
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
  // Which inputs the list on screen answers. A refresh of those same inputs that
  // fails (offline, after a return to the foreground) keeps the list rather than
  // replacing it with an error.
  const shownKey = useRef<string | null>(null);

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
    const key = `${regionId}|${page}|${query}`;
    setError(null);
    api
      .logbook(regionId, { page, pageSize: PAGE_SIZE, search: query }, controller.signal)
      .then((next) => {
        shownKey.current = key;
        setData(next);
      })
      .catch((caught: unknown) => {
        if (caught instanceof Error && caught.name === "AbortError") return;
        if (shownKey.current === key) return;
        setError(caught instanceof Error ? caught.message : "Could not load the logbook.");
      });
    return () => controller.abort();
  }, [regionId, page, query, reloadKey, logVersion]);

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

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

/** A Postgres numeric arrives as a string; an absent one as null. */
function formatKm(value: number): string {
  return value.toFixed(1);
}

function dateRange(start: string | null, end: string | null): string {
  if (!start || !end) return "No journeys yet";
  return formatDateOnlyRange(start, end);
}
