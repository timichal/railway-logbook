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
 */
import { Ionicons } from "@expo/vector-icons";
import type { Station } from "@shared/types";
import { type ReactNode, useState } from "react";
import { Keyboard, Pressable, TextInput, View } from "react-native";
import { useRegion } from "@/region/RegionContext";
import { StationResults } from "@/stations/StationResults";
import { useStationSearch } from "@/stations/useStationSearch";

export function MapStationSearch({ onSelect }: { onSelect(station: Station): void }): ReactNode {
  const { regionId } = useRegion();
  const [open, setOpen] = useState(false);
  const { query, setQuery, results, searching, reset } = useStationSearch(regionId);

  const close = (): void => {
    setOpen(false);
    reset();
    Keyboard.dismiss();
  };

  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Search for a station"
        onPress={() => setOpen(true)}
        className="h-11 w-11 items-center justify-center self-start rounded-full bg-white/95 active:opacity-80 dark:bg-gray-900/95"
      >
        <Ionicons name="search" size={20} color="#374151" />
      </Pressable>
    );
  }

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2 rounded-xl bg-white/95 px-3 dark:bg-gray-900/95">
        <Ionicons name="search" size={18} color="#6b7280" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search for a station"
          placeholderTextColor="#9ca3af"
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
          <Ionicons name="close" size={20} color="#6b7280" />
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
