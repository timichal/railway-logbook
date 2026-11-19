/**
 * The line picked in the map's search box, named under the map's top row, and the
 * way to stop highlighting it — the web's chip under its search box.
 *
 * Its own row rather than a place in the top one: the middle of that row is the
 * logbook's highlight (`HighlightChip`), and the two can be up at once — a journey
 * opened from the logbook, then the line it ran on looked up.
 *
 * A status the band can't show is said in the chip, rather than naming a highlight
 * that draws nothing: every route of the line on a switched-off layer, or a load that
 * failed (picking the line again retries it).
 */
import { Ionicons } from "@expo/vector-icons";
import { lineSearchHighlightColor } from "@shared/map/highlightLayers";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { LineHighlight } from "@/map/useLineHighlight";
import { useNativeColors } from "@/theme/colors";
import { useTheme } from "@/theme/ThemeContext";

/** The chip's height, for the camera fit to stay clear of it (`RailwayMap`). */
export const LINE_CHIP_HEIGHT = 44;

const STATUS_NOTE: Partial<Record<LineHighlight["status"], string>> = {
  hidden: "layer hidden",
  failed: "failed to load",
};

export function LineChip({ highlight }: { highlight: LineHighlight }): ReactNode {
  const { resolved: theme } = useTheme();
  const colors = useNativeColors();
  const { line, status, setLine } = highlight;

  if (!line) return null;

  const note = STATUS_NOTE[status];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${line.name} highlighted${note ? `, ${note}` : ""}`}
      accessibilityHint="Stops highlighting the line"
      onPress={() => setLine(null)}
      style={{ minHeight: LINE_CHIP_HEIGHT }}
      className="max-w-full shrink flex-row items-center gap-2 self-start rounded-full bg-white/95 px-4 active:opacity-80 dark:bg-gray-900/95"
    >
      {/* The band in miniature */}
      <View
        className="h-2.5 w-4 rounded-full"
        style={{
          backgroundColor: lineSearchHighlightColor(theme),
          opacity: status === "drawn" ? 0.6 : 0.25,
        }}
      />
      <Text
        numberOfLines={1}
        className="shrink text-sm font-semibold text-gray-900 dark:text-gray-100"
      >
        {line.name}
      </Text>
      {status === "loading" ? <ActivityIndicator size="small" /> : null}
      {note ? (
        <Text
          className={`text-xs ${
            status === "failed"
              ? "text-red-600 dark:text-red-400"
              : "text-gray-500 dark:text-gray-400"
          }`}
        >
          {note}
        </Text>
      ) : null}
      <Ionicons name="close" size={16} color={colors.icon} />
    </Pressable>
  );
}
