/**
 * What the selection looks like from the map: one row under it saying how many
 * routes are picked, and the way into the logging screen.
 *
 * A **flex sibling of the map, not an overlay** — the same argument the web app's
 * bottom sheet makes. The map's own bottom furniture (the progress box, MapLibre's
 * attribution) lives in its bottom corners, and a bar floating over them would cover
 * exactly the two things that have to stay readable.
 *
 * The row itself is the way in, so there is nothing to aim at; the only separate
 * control is the one that throws the selection away, which is worth keeping distinct
 * from the one that opens it.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useSelection } from "@/logbook/SelectionContext";

export function SelectionBar(): ReactNode {
  const router = useRouter();
  const { selected, clear } = useSelection();

  if (selected.length === 0) return null;

  const km = selected.reduce((sum, s) => sum + s.route.lengthKm, 0);

  return (
    <View className="flex-row items-center border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Log ${selected.length} selected routes`}
        onPress={() => router.push("/log-journey")}
        className="min-h-14 flex-1 flex-row items-center gap-3 px-4 active:opacity-70"
      >
        <View className="flex-1">
          <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {selected.length} {selected.length === 1 ? "route" : "routes"} selected
          </Text>
          <Text className="text-xs text-gray-600 dark:text-gray-400">
            {km.toFixed(1)} km · tap to log a journey
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#6b7280" />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Clear selection"
        onPress={clear}
        className="h-14 w-14 items-center justify-center active:opacity-70"
      >
        <Ionicons name="close-circle-outline" size={22} color="#6b7280" />
      </Pressable>
    </View>
  );
}
