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
 * Each slot owns its own search, because each slot's results belong under it. The web
 * app shares one result set across from/via/to precisely because it must not have two
 * dropdowns open at once; nothing here can overlap, so there is nothing to
 * coordinate.
 */
import { Ionicons } from "@expo/vector-icons";
import type { Station } from "@shared/types";
import type { ReactNode } from "react";
import { Keyboard, Pressable, Text, TextInput, View } from "react-native";
import { useRegion } from "@/region/RegionContext";
import { StationResults } from "@/stations/StationResults";
import { useStationSearch } from "@/stations/useStationSearch";

interface StationFieldProps {
  label: string;
  placeholder: string;
  value: Station | null;
  onChange(station: Station | null): void;
}

export function StationField({
  label,
  placeholder,
  value,
  onChange,
}: StationFieldProps): ReactNode {
  const { regionId } = useRegion();
  const { query, setQuery, results, searching, reset } = useStationSearch(regionId);

  if (value) {
    return (
      <View className="gap-1.5">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</Text>
        <View className="min-h-11 flex-row items-center gap-2 rounded-xl border border-blue-300 bg-blue-50 px-3 dark:border-blue-700 dark:bg-blue-950">
          <Text className="flex-1 text-base text-gray-900 dark:text-gray-100">{value.name}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            onPress={() => onChange(null)}
            className="h-11 w-8 items-center justify-center active:opacity-70"
          >
            <Ionicons name="close" size={18} color="#6b7280" />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        autoCorrect={false}
        returnKeyType="search"
        className="min-h-11 rounded-xl border border-gray-300 bg-white px-3 text-base text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      />
      <StationResults
        results={results}
        searching={searching}
        queryLength={query.trim().length}
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
