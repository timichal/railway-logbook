/**
 * The map's station search — the web map's search box, as a phone can hold it.
 *
 * **Collapsed to a button until it is wanted.** On the web the box sits permanently
 * in the map's top-left corner, which a desktop map has the room for; here the map is
 * the whole screen and a field across the top of it would cost a strip of the thing
 * being searched. So it is a round button that becomes the field, and goes back to
 * being a button once a station has been picked.
 *
 * Picking one flies the camera to it and closes the keyboard: the answer to "where is
 * Kőbánya-Kispest" is the map, and nothing about it can be seen from behind a
 * keyboard and a list of near-misses.
 *
 * Whether it is open is `MapTopControls`' state, not this one's: the open field takes
 * the whole top row, so the row has to know.
 */
import { Ionicons } from "@expo/vector-icons";
import type { Station } from "@shared/types";
import type { ReactNode } from "react";
import { Keyboard, Pressable, TextInput, View } from "react-native";
import { useRegion } from "@/region/RegionContext";
import { StationResults } from "@/stations/StationResults";
import { useStationSearch } from "@/stations/useStationSearch";
import { useNativeColors } from "@/theme/colors";

/** The collapsed search: a round button in the row's leading corner. */
export function MapSearchButton({ onPress }: { onPress(): void }): ReactNode {
  const colors = useNativeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Search for a station"
      onPress={onPress}
      className="h-11 w-11 items-center justify-center rounded-full bg-white/95 active:opacity-80 dark:bg-gray-900/95"
    >
      <Ionicons name="search" size={20} color={colors.iconStrong} />
    </Pressable>
  );
}

/** The open search: the field and its results, as wide as the row. */
export function MapStationSearch({
  onSelect,
  onClose,
}: {
  onSelect(station: Station): void;
  onClose(): void;
}): ReactNode {
  const { regionId } = useRegion();
  const colors = useNativeColors();
  const { query, setQuery, results, searching, reset } = useStationSearch(regionId);

  const close = (): void => {
    reset();
    Keyboard.dismiss();
    onClose();
  };

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2 rounded-xl bg-white/95 px-3 dark:bg-gray-900/95">
        <Ionicons name="search" size={18} color={colors.icon} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search for a station"
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
      <StationResults
        results={results}
        searching={searching}
        queryLength={query.trim().length}
        onSelect={(station) => {
          onSelect(station);
          close();
        }}
      />
    </View>
  );
}
