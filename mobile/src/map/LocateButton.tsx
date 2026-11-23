/**
 * "Where am I": a round button over the map's bottom-right corner, under the credits'
 * ⓘ and above the planner's button, so both stay under the thumb. `RailwayMap` places
 * the column and does the work (it holds the camera); this is the button, with a
 * spinner while a fix is awaited.
 *
 * The icon fills in once the dot is on the map, as map apps mark it. The background is
 * solid: iOS can't work a shadow out cheaply from a see-through one, and says so.
 */
import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable } from "react-native";
import { useNativeColors } from "@/theme/colors";

export const LOCATE_BUTTON_SIZE = 44;

export function LocateButton({
  busy,
  shown,
  onPress,
}: {
  /** A fix is being waited for. */
  busy: boolean;
  /** The dot is on the map. */
  shown: boolean;
  onPress(): void;
}): ReactNode {
  const colors = useNativeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Show my location"
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={{ width: LOCATE_BUTTON_SIZE, height: LOCATE_BUTTON_SIZE }}
      className="items-center justify-center rounded-full bg-white shadow-md active:opacity-80 dark:bg-gray-900"
    >
      {busy ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Ionicons
          name={shown ? "locate" : "locate-outline"}
          size={22}
          color={shown ? colors.accent : colors.iconStrong}
        />
      )}
    </Pressable>
  );
}
