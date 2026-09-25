/**
 * The way into the journey planner, over the map's top-right corner.
 *
 * On the map rather than in a tab of its own because that is what a plan is about:
 * you ask for a path and then look at where it goes. The search box holds the
 * opposite corner and the highlight chip the middle, so the three pieces of top
 * furniture never meet.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function PlannerButton(): ReactNode {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View pointerEvents="box-none" className="absolute right-2" style={{ top: insets.top + 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Plan a journey"
        onPress={() => router.push("/plan-journey")}
        className="h-11 w-11 items-center justify-center rounded-full bg-white/95 active:opacity-80 dark:bg-gray-900/95"
      >
        <Ionicons name="git-branch-outline" size={20} color="#374151" />
      </Pressable>
    </View>
  );
}
