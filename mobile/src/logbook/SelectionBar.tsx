/**
 * What the selection looks like from the map: one row under it saying how many
 * routes are picked, and the way into the logging screen.
 *
 * A **flex sibling of the map, not an overlay** — the same argument the web app's
 * bottom sheet makes. The map's own bottom furniture (the progress box, the planner,
 * locate and credits buttons) lives in its bottom corners, and a bar floating over them would cover
 * exactly the two things that have to stay readable.
 *
 * The row itself is the way in, so there is nothing to aim at; the only separate
 * control is the one that throws the selection away, which is worth keeping distinct
 * from the one that opens it.
 *
 * While a saved journey is being edited the bar is that edit's, shown even with no
 * routes left (the edit isn't over), and its × stops the edit, asking first when it
 * changed something. The new journey's selection comes back after it.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { confirmClearSelection, confirmStopEditing } from "@/logbook/confirmClearSelection";
import { loggedLengthKm, useSelection } from "@/logbook/SelectionContext";
import { useNativeColors } from "@/theme/colors";
import { formatKm } from "@/ui/format";

export function SelectionBar(): ReactNode {
  const colors = useNativeColors();
  const router = useRouter();
  const { selected, clear, editing, endEdit } = useSelection();

  if (selected.length === 0 && !editing) return null;

  // As the journey will log it: a planner stretch counts its own length
  const km = selected.reduce((sum, s) => sum + loggedLengthKm(s), 0);
  const routes = `${selected.length} ${selected.length === 1 ? "route" : "routes"}`;

  return (
    <View className="flex-row items-center border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          editing
            ? `Editing ${editing.name}, ${routes}, ${formatKm(km)} km`
            : `${routes} selected, ${formatKm(km)} km`
        }
        accessibilityHint={editing ? "Reviews and saves the journey" : "Logs a journey"}
        onPress={() => router.push("/log-journey")}
        className="min-h-14 flex-1 flex-row items-center gap-3 px-4 active:opacity-70"
      >
        <View className="flex-1">
          <Text
            className="text-base font-semibold text-gray-900 dark:text-gray-100"
            numberOfLines={1}
          >
            {editing ? `Editing “${editing.name}”` : `${routes} selected`}
          </Text>
          <Text className="text-xs text-gray-600 dark:text-gray-400">
            {editing
              ? `${routes} · ${formatKm(km)} km · tap to review and save`
              : `${formatKm(km)} km · tap to log a journey`}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.icon} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={editing ? "Cancel editing" : "Clear selection"}
        onPress={() =>
          editing
            ? confirmStopEditing(editing, endEdit)
            : confirmClearSelection(selected.length, clear)
        }
        className="h-14 w-14 items-center justify-center active:opacity-70"
      >
        <Ionicons name="close-circle-outline" size={22} color={colors.icon} />
      </Pressable>
    </View>
  );
}
