/**
 * The numbers, over the bottom-left corner of the map — `MapProgressBox` on the web,
 * including its mobile behaviour: collapsed it is a percentage pill, and **the same
 * tap opens and closes it**, because the numbers are the control and there is no ×
 * to aim at.
 *
 * It carries no layer switches: those are in the Settings tab, and the counted line
 * types' (Japan's JR and non-JR lines) on the Statistics screen.
 */
import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Progress } from "@/api/endpoints";
import { formatKm, formatPercent } from "@/ui/format";

interface MapProgressBoxProps {
  progress: Progress | null;
}

export function MapProgressBox({ progress }: MapProgressBoxProps): ReactNode {
  const [expanded, setExpanded] = useState(false);

  if (!progress) return null;

  const km = `${formatKm(progress.completedKm)} of ${formatKm(progress.totalKm)} km`;
  const routes = `${progress.completedRoutes} of ${progress.totalRoutes} routes`;

  return (
    <View className="absolute bottom-2 left-2">
      <Pressable
        accessibilityRole="button"
        // The label replaces the text, so it carries the numbers; the hint says what a
        // press does
        accessibilityLabel={
          expanded
            ? `Progress: ${km}, ${formatPercent(progress.percentage)} of track. ${routes}, ${formatPercent(progress.routePercentage)}`
            : `Progress: ${formatPercent(progress.percentage)} of track`
        }
        accessibilityHint={expanded ? "Hides the details" : "Shows the details"}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((open) => !open)}
        className="min-h-11 justify-center rounded-xl bg-white/95 px-3 py-2 active:opacity-80 dark:bg-gray-900/95"
      >
        {expanded ? (
          <View className="gap-1">
            <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {formatKm(progress.completedKm)} / {formatKm(progress.totalKm)} km
            </Text>
            <Text className="text-xs text-gray-600 dark:text-gray-400">
              {formatPercent(progress.percentage)} of track
            </Text>
            <Text className="text-xs text-gray-600 dark:text-gray-400">
              {progress.completedRoutes} / {progress.totalRoutes} routes ·{" "}
              {formatPercent(progress.routePercentage)}
            </Text>
          </View>
        ) : (
          <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {formatPercent(progress.percentage)}
          </Text>
        )}
      </Pressable>
    </View>
  );
}
