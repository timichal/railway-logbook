/**
 * The numbers, over the bottom-left corner of the map — `MapProgressBox` on the web,
 * including its mobile behaviour: collapsed it is a percentage pill, and **the same
 * tap opens and closes it**, because the numbers are the control and there is no ×
 * to aim at.
 *
 * It sits above the map's own bottom-right attribution rather than beside it, and
 * carries no layer switches: those are in the Settings tab, which is this app's
 * hamburger menu.
 */
import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Progress } from "@/api/endpoints";

interface MapProgressBoxProps {
  progress: Progress | null;
}

export function MapProgressBox({ progress }: MapProgressBoxProps): ReactNode {
  const [expanded, setExpanded] = useState(false);

  if (!progress) return null;

  return (
    <View className="absolute bottom-2 left-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Hide progress" : "Show progress"}
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
              {progress.percentage.toFixed(1)}% of track
            </Text>
            <Text className="text-xs text-gray-600 dark:text-gray-400">
              {progress.completedRoutes} / {progress.totalRoutes} routes ·{" "}
              {progress.routePercentage.toFixed(1)}%
            </Text>
          </View>
        ) : (
          <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {progress.percentage.toFixed(1)}%
          </Text>
        )}
      </Pressable>
    </View>
  );
}

function formatKm(value: number): string {
  return Math.round(value).toLocaleString();
}
