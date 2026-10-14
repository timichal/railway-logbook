/**
 * The way into the journey planner, at the trailing end of the map's top row
 * (`MapTopControls`).
 *
 * On the map rather than in a tab of its own because that is what a plan is about:
 * you ask for a path and then look at where it goes.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { useNativeColors } from "@/theme/colors";

export function PlannerButton(): ReactNode {
  const router = useRouter();
  const colors = useNativeColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Plan a journey"
      onPress={() => router.push("/plan-journey")}
      className="h-11 w-11 items-center justify-center rounded-full bg-white/95 active:opacity-80 dark:bg-gray-900/95"
    >
      <Ionicons name="git-branch-outline" size={20} color={colors.iconStrong} />
    </Pressable>
  );
}
