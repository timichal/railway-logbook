/**
 * The list under a station field.
 *
 * One component for the map's search box and the planner's fields, because they are
 * the same list of the same thing and only differ in what a pick does with it.
 *
 * The web app's equivalent is an absolutely-positioned dropdown that has to fight the
 * field's own blur to stay open long enough to be tapped (`StationSearchInput`, and
 * the `preventDefault` on pointerdown that keeps focus where it is). None of that
 * ports: here the list is an ordinary sibling in the layout, a press on a row is
 * delivered to that row, and focus has nothing to do with it. What does port is the
 * dismissal of the keyboard on a pick, which the callers do — a list of results is
 * useless under a keyboard covering the map it is about to fly to.
 */
import type { Station } from "@shared/types";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

interface StationResultsProps {
  results: Station[];
  searching: boolean;
  /** How long the text in the field is, so "nothing found" is only said once it means it. */
  queryLength: number;
  onSelect(station: Station): void;
}

/** Matches the server's floor: under this it answers with none, which is not "no match". */
const MIN_QUERY_LENGTH = 2;

export function StationResults({
  results,
  searching,
  queryLength,
  onSelect,
}: StationResultsProps): ReactNode {
  if (queryLength < MIN_QUERY_LENGTH) return null;

  if (results.length === 0) {
    return (
      <View className="flex-row items-center gap-2 px-3 py-2">
        {searching ? <ActivityIndicator size="small" /> : null}
        <Text className="text-sm text-gray-500 dark:text-gray-400">
          {searching ? "Searching…" : "No stations found."}
        </Text>
      </View>
    );
  }

  return (
    <View className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      {results.map((station, index) => (
        <Pressable
          key={station.id}
          accessibilityRole="button"
          onPress={() => onSelect(station)}
          className={`min-h-11 justify-center bg-white px-3 py-2 active:bg-gray-100 dark:bg-gray-800 dark:active:bg-gray-700 ${
            index === 0 ? "" : "border-t border-gray-200 dark:border-gray-700"
          }`}
        >
          <Text className="text-sm text-gray-900 dark:text-gray-100">{station.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}
