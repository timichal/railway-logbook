/**
 * One station slot in the planner form.
 *
 * **Two states, not one.** Until a station is picked the slot is a text field with
 * its results underneath; once one is picked it is the name and a button to take it
 * back. The web app keeps a single input throughout and says "chosen" with a border
 * colour, which works when the list is a dropdown that closes itself — here the
 * results are part of the layout, and a field that still looks searchable while
 * holding an answer would keep its list open under every other row.
 *
 * **One slot is the map's target** (`targeted`): a station tapped on the map above
 * the planner's sheet goes into it (`PlannerContext.pickOnMap`). It is drawn with an
 * accent border, and says so — in the placeholder while empty, under the name once
 * filled. Tapping a filled slot's name, or typing into an empty one, makes it the
 * target (`onTarget`), as focusing a field does on the web.
 *
 * Each slot owns its own search, because each slot's results belong under it. The web
 * app shares one result set across from/via/to precisely because it must not have two
 * dropdowns open at once; nothing here can overlap, so there is nothing to
 * coordinate.
 */
import { Ionicons } from "@expo/vector-icons";
import { searchQueryLength } from "@shared/searchQuery";
import type { Station } from "@shared/types";
import { type ReactNode, useEffect } from "react";
import { Keyboard, Pressable, Text, TextInput, View } from "react-native";
import { useRegion } from "@/region/RegionContext";
import { StationResults } from "@/stations/StationResults";
import { useStationSearch } from "@/stations/useStationSearch";
import { useNativeColors } from "@/theme/colors";

interface StationFieldProps {
  label: string;
  value: Station | null;
  onChange(station: Station | null): void;
  /** A station tapped on the map goes here. */
  targeted: boolean;
  onTarget(): void;
}

export function StationField({
  label,
  value,
  onChange,
  targeted,
  onTarget,
}: StationFieldProps): ReactNode {
  const colors = useNativeColors();
  const { regionId } = useRegion();
  const { query, setQuery, results, searching, error, reset } = useStationSearch(regionId);

  // Filled from the map, the slot drops what was being typed into it, as a pick does
  useEffect(() => {
    if (value) reset();
  }, [value, reset]);

  // The border thickens without moving the text: the padding gives up what it takes
  const frame = targeted ? "border-2 border-blue-500 px-[11px]" : "border px-3";

  if (value) {
    return (
      <View className="gap-1.5">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</Text>
        <View
          className={`min-h-11 flex-row items-center gap-2 rounded-xl bg-blue-50 dark:bg-blue-950 ${frame} ${
            targeted ? "" : "border-blue-300 dark:border-blue-700"
          }`}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${value.name}`}
            accessibilityHint={
              targeted
                ? "A station tapped on the map replaces it"
                : "Makes it the one a station tapped on the map replaces"
            }
            accessibilityState={{ selected: targeted }}
            onPress={onTarget}
            className="min-h-11 flex-1 justify-center"
          >
            <Text className="text-base text-gray-900 dark:text-gray-100">{value.name}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            onPress={() => onChange(null)}
            className="h-11 w-8 items-center justify-center active:opacity-70"
          >
            <Ionicons name="close" size={18} color={colors.icon} />
          </Pressable>
        </View>
        {targeted ? (
          <Text className="text-xs text-gray-600 dark:text-gray-400">
            Tap a station on the map to replace it.
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        onFocus={onTarget}
        placeholder={targeted ? "Search, or tap a station on the map" : "Search for a station"}
        placeholderTextColor={colors.placeholder}
        autoCorrect={false}
        returnKeyType="search"
        className={`min-h-11 rounded-xl bg-white text-base text-gray-900 dark:bg-gray-800 dark:text-gray-100 ${frame} ${
          targeted ? "" : "border-gray-300 dark:border-gray-600"
        }`}
      />
      <StationResults
        results={results}
        searching={searching}
        error={error}
        queryLength={searchQueryLength(query)}
        onSelect={(station) => {
          onChange(station);
          reset();
          // Nothing else on this form is typed into, and the next thing to press is
          // usually below the fold.
          Keyboard.dismiss();
        }}
      />
    </View>
  );
}
