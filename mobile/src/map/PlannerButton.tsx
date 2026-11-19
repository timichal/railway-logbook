/**
 * The way into the journey planner: a labelled button over the map's bottom-right
 * corner, opposite the progress box.
 *
 * **At the bottom, where the thumb is.** Planning is the map's main errand, and the top
 * corners of a phone are the hardest place to reach one-handed. The label says what
 * it is: no icon reads as "plan a journey" on its own. On the map rather than in a tab
 * of its own because that is what a plan is about: you ask for a path and then look
 * at where it goes, with the planner's sheet over the lower half (`plannerSheet.ts`).
 *
 * **It never opens a second planner.** The sheet covers it while open, but should a
 * press reach it then, it closes the planner rather than stacking another.
 *
 * **A dot says a plan is under way**: the form outlives the planner, so a From picked
 * on the map waits for a To with the planner closed, and the button is where that
 * shows.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { usePlanner } from "@/logbook/PlannerContext";

/** Its height, which the attribution sits above and the map's fits and open search clear. */
export const PLANNER_BUTTON_HEIGHT = 48;

export function PlannerButton(): ReactNode {
  const router = useRouter();
  const { form, sheetOpen } = usePlanner();
  const underWay = form.from !== null || form.to !== null || form.vias.some((s) => s !== null);

  return (
    <View pointerEvents="box-none" className="absolute bottom-2 right-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={underWay ? "Plan journey, stations picked" : "Plan journey"}
        accessibilityHint={sheetOpen ? "Closes the journey planner" : undefined}
        onPress={() => (sheetOpen ? router.back() : router.push("/plan-journey"))}
        style={{ height: PLANNER_BUTTON_HEIGHT }}
        className="flex-row items-center gap-2 rounded-full bg-blue-600 pl-4 pr-5 shadow-md active:bg-blue-700"
      >
        <Ionicons name="git-branch-outline" size={20} color="#ffffff" />
        <Text className="text-base font-semibold text-white">Plan journey</Text>
        {underWay ? (
          <View className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border border-white bg-amber-400" />
        ) : null}
      </Pressable>
    </View>
  );
}
