/**
 * The map's search box — the web map's search box, as a phone can hold it: stations,
 * and lines where the region names them (`hasRouteNames`), from one request
 * (`/search`).
 *
 * **Always across the top, as map apps have it.** Collapsed it is a bar that looks
 * exactly like the field (`MapSearchBar`): it says what can be searched, which a round
 * magnifier never did (in Japan, that lines can be), and costs only the strip beside
 * it, mostly under the status bar's shade. A tap opens the real field in its place,
 * with the keyboard up, and it collapses again once something has been picked. Two
 * states rather than one live field because the open one carries its results list
 * and takes the space down to the bottom furniture (`MapTopControls`).
 *
 * Picking a station flies the camera to it, and picking a line fits the camera to it
 * and draws its band (`useLineHighlight`); either closes the keyboard: the answer to
 * "where is Kőbánya-Kispest" is the map, and nothing about it can be seen from behind
 * a keyboard and a list of near-misses. The lines lead the list, as on the web: a
 * query that names a line means it, where a station name turning up inside a line
 * name is incidental.
 *
 * Whether it is open is `MapTopControls`' state, not this one's: the open field hides
 * the chips under it, so the row has to know.
 */
import { Ionicons } from "@expo/vector-icons";
import { REGIONS, type RegionId } from "@shared/regions";
import { searchQueryLength } from "@shared/searchQuery";
import type { LineSearchResult, MapSearchResults, Station } from "@shared/types";
import type { ReactNode } from "react";
import { Keyboard, Pressable, Text, TextInput, View } from "react-native";
import * as api from "@/api/endpoints";
import { useRegion } from "@/region/RegionContext";
import { SearchResultList, SearchResultRow } from "@/stations/StationResults";
import { useNameSearch } from "@/stations/useStationSearch";
import { useNativeColors } from "@/theme/colors";

const NO_RESULTS: MapSearchResults = { lines: [], stations: [] };

function searchLabel(regionId: RegionId): string {
  return REGIONS[regionId].hasRouteNames ? "Search lines and stations" : "Search for a station";
}

/**
 * The collapsed search: the open field's own frame, icon and placeholder, so opening
 * it changes nothing on screen but the keyboard and the cursor.
 */
export function MapSearchBar({ onPress }: { onPress(): void }): ReactNode {
  const { regionId } = useRegion();
  const colors = useNativeColors();
  return (
    <Pressable
      accessibilityRole="search"
      accessibilityLabel={searchLabel(regionId)}
      onPress={onPress}
      className="min-h-11 flex-row items-center gap-2 rounded-xl bg-white/95 px-3 active:opacity-80 dark:bg-gray-900/95"
    >
      <Ionicons name="search" size={18} color={colors.icon} />
      <Text numberOfLines={1} className="flex-1 text-base" style={{ color: colors.placeholder }}>
        {searchLabel(regionId)}
      </Text>
    </Pressable>
  );
}

function routeCount(count: number): string {
  return `${count} ${count === 1 ? "route" : "routes"}`;
}

/** The open search: the field and its results, as wide as the row. */
export function MapStationSearch({
  onSelectStation,
  onSelectLine,
  onClose,
}: {
  onSelectStation(station: Station): void;
  onSelectLine(line: LineSearchResult): void;
  onClose(): void;
}): ReactNode {
  const { regionId } = useRegion();
  const colors = useNativeColors();
  const { query, setQuery, results, searching, error, reset } = useNameSearch(
    regionId,
    api.mapSearch,
    NO_RESULTS,
  );
  const withLines = REGIONS[regionId].hasRouteNames;

  const close = (): void => {
    reset();
    Keyboard.dismiss();
    onClose();
  };

  return (
    // `shrink`, so the list is held to the height `MapTopControls` gives it
    <View className="shrink gap-2">
      <View className="flex-row items-center gap-2 rounded-xl bg-white/95 px-3 dark:bg-gray-900/95">
        <Ionicons name="search" size={18} color={colors.icon} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={searchLabel(regionId)}
          placeholderTextColor={colors.placeholder}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          className="min-h-11 flex-1 text-base text-gray-900 dark:text-gray-100"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close the search"
          onPress={close}
          className="h-11 w-8 items-center justify-center active:opacity-70"
        >
          <Ionicons name="close" size={20} color={colors.icon} />
        </Pressable>
      </View>
      <SearchResultList
        count={results.lines.length + results.stations.length}
        searching={searching}
        error={error}
        queryLength={searchQueryLength(query)}
        emptyLabel={withLines ? "No lines or stations found." : "No stations found."}
        floating
      >
        {results.lines.map((line, index) => (
          <SearchResultRow
            key={`line:${line.name}`}
            title={line.name}
            detail={`Line · ${routeCount(line.routeCount)}`}
            accessibilityLabel={`${line.name}, line, ${routeCount(line.routeCount)}`}
            first={index === 0}
            onPress={() => {
              onSelectLine(line);
              close();
            }}
          />
        ))}
        {results.stations.map((station, index) => (
          <SearchResultRow
            key={`station:${station.id}`}
            title={station.name}
            // Only where there are lines to tell a station apart from
            detail={withLines ? "Station" : undefined}
            accessibilityLabel={withLines ? `${station.name}, station` : undefined}
            first={index === 0 && results.lines.length === 0}
            onPress={() => {
              onSelectStation(station);
              close();
            }}
          />
        ))}
      </SearchResultList>
    </View>
  );
}
