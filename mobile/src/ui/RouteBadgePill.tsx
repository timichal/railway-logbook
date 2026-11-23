import type { RouteBadge } from "@shared/map/routeFeature";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";

/**
 * One route badge (`routeBadges` / `closedRowBadge`), in the colours of the scheme
 * shown. The colours are data, not classes, so they are set as styles.
 */
export function RouteBadgePill({ badge }: { badge: RouteBadge }): ReactNode {
  const { resolved: theme } = useTheme();
  const colors = theme === "dark" ? badge.dark : badge;
  return (
    <View className="rounded px-1.5 py-0.5" style={{ backgroundColor: colors.bgColor }}>
      <Text className="text-xs font-semibold" style={{ color: colors.color }}>
        {badge.label}
      </Text>
    </View>
  );
}
