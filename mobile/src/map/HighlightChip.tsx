/**
 * What the map is currently pointing at, and the way to stop it.
 *
 * The web app's highlight clears itself when the card that set it closes, because
 * the card and the map are side by side and closing one is visibly letting go of the
 * other. Here the highlight is set in a different tab, so the map has to say what it
 * is showing and offer to drop it — otherwise an orange network stays orange with
 * nothing on screen explaining why.
 *
 * Over the top edge rather than the bottom: the bottom corners are the progress box
 * and the attribution, and the selection bar is below the map entirely.
 */
import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useHighlight } from "@/logbook/HighlightContext";

export function HighlightChip(): ReactNode {
  const { trackIds, color, clear } = useHighlight();

  if (trackIds.length === 0) return null;

  return (
    <View className="absolute inset-x-0 top-2 items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Clear the highlight"
        onPress={clear}
        className="min-h-11 flex-row items-center gap-2 rounded-full bg-white/95 px-4 active:opacity-80 dark:bg-gray-900/95"
      >
        {/* The dot is the legend, in the set's own colour: gold means a plan,
            orange means something already logged. */}
        <View className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
        <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {trackIds.length} {trackIds.length === 1 ? "route" : "routes"} highlighted
        </Text>
        <Ionicons name="close" size={16} color="#6b7280" />
      </Pressable>
    </View>
  );
}
