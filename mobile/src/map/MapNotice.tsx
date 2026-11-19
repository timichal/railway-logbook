/**
 * A one-line message along the bottom of the map, in place of the feature sheet: for
 * a tap that could not be answered. It goes by itself after a few seconds, on its
 * close button, or with the next press on the map.
 */
import { Ionicons } from "@expo/vector-icons";
import { type ReactNode, useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { useNativeColors } from "@/theme/colors";

const SHOWN_MS = 4_000;

export interface MapNoticeContent {
  /** `offline`: no connection to ask over; `error`: asked, and no answer to show. */
  kind: "offline" | "error";
  message: string;
}

export function MapNotice({
  notice,
  onClose,
}: {
  notice: MapNoticeContent;
  onClose(): void;
}): ReactNode {
  const colors = useNativeColors();

  useEffect(() => {
    const timer = setTimeout(onClose, SHOWN_MS);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className="absolute inset-x-0 bottom-0 flex-row items-center gap-2 rounded-t-2xl border-t border-gray-200 bg-white pb-8 pl-4 pt-2 dark:border-gray-700 dark:bg-gray-900"
    >
      <Ionicons
        name={notice.kind === "offline" ? "cloud-offline-outline" : "alert-circle-outline"}
        size={20}
        color={colors.icon}
      />
      <Text className="flex-1 text-sm text-gray-900 dark:text-gray-100">{notice.message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        className="h-11 w-11 items-center justify-center"
      >
        <Ionicons name="close" size={22} color={colors.icon} />
      </Pressable>
    </View>
  );
}
