/** Trips and journeys, in Phase 4. */
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Screen } from "@/ui/Screen";

export default function LogbookScreen(): ReactNode {
  return (
    <Screen edges={["top"]}>
      <View className="flex-1 items-center justify-center gap-2 p-6">
        <Text className="text-xl font-semibold text-gray-900 dark:text-gray-100">Logbook</Text>
        <Text className="text-center text-sm text-gray-600 dark:text-gray-400">
          Your trips and journeys land here in Phase 4.
        </Text>
      </View>
    </Screen>
  );
}
