/**
 * A screen's frame: the safe-area inset and the page background in one place, which
 * is the same argument the web app's `safe-area` utility makes — inset the frame
 * once rather than remember it at every edge-touching element.
 */
import type { ReactNode } from "react";
import { View } from "react-native";
import { type Edge, SafeAreaView } from "react-native-safe-area-context";

interface ScreenProps {
  children: ReactNode;
  /** Which edges to inset. A screen inside the tab bar leaves the bottom to it. */
  edges?: readonly Edge[];
  className?: string;
}

export function Screen({
  children,
  edges = ["top", "bottom"],
  className = "",
}: ScreenProps): ReactNode {
  return (
    <SafeAreaView edges={edges} className="flex-1 bg-white dark:bg-gray-900">
      <View className={`flex-1 ${className}`}>{children}</View>
    </SafeAreaView>
  );
}
