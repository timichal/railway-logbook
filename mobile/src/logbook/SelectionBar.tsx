/**
 * What the selection looks like from the map: one row under it saying how many
 * routes are picked, and the way into the logging screen.
 *
 * The map's **footer** (`RailwayMap`): laid over the map's bottom edge, with the
 * map's own bottom furniture (the progress box, the planner, locate and credits
 * buttons, a route's sheet) standing on it rather than covered by it. Not a flex
 * sibling of the map, which it was: the map resized as the bar came and went, and
 * jumped by half the bar's height.
 *
 * The row itself is the way in, so there is nothing to aim at; the only separate
 * control is the one that throws the selection away, which is worth keeping distinct
 * from the one that opens it.
 *
 * While a saved journey is open (`editing`, from its logbook card) the bar is that
 * journey's, shown even with no routes left (it is still open), and its × closes it,
 * asking first when something changed. Open is also how a journey is looked at, so
 * the bar names it rather than announcing an edit. The new journey's selection comes
 * back after it.
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
  const { selected, form, clear, editing, endEdit } = useSelection();
  // The draft's name, renamed or not: the bar is the journey as it stands
  const name = editing ? form.name.trim() || editing.name : "";

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
            ? `${name}, ${routes}, ${formatKm(km)} km${editing.changed ? ", unsaved changes" : ""}`
            : `${routes} selected, ${formatKm(km)} km`
        }
        accessibilityHint={editing ? "Edits the journey's details and saves" : "Logs a journey"}
        onPress={() => router.push("/log-journey")}
        className="min-h-14 flex-1 flex-row items-center gap-3 px-4 active:opacity-70"
      >
        <View className="flex-1">
          <Text
            className="text-base font-semibold text-gray-900 dark:text-gray-100"
            numberOfLines={1}
          >
            {editing ? `“${name}”` : `${routes} selected`}
          </Text>
          <Text className="text-xs text-gray-600 dark:text-gray-400">
            {editing
              ? `${routes} · ${formatKm(km)} km · ${editing.changed ? "unsaved changes, tap to save" : "tap to edit"}`
              : `${formatKm(km)} km · tap to log a journey`}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.icon} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={editing ? `Close ${name}` : "Clear selection"}
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
