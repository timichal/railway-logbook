/**
 * The three tabs the app is going to be: the map (Phase 3), the logbook (Phase 4),
 * and the settings that the web app keeps in its hamburger menu.
 *
 * The tab bar's colours are passed as values rather than class names — it is a native
 * view configured by props, so NativeWind has nothing to hook into.
 */
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ReactNode } from "react";
import { useTheme } from "@/theme/ThemeContext";

const TAB_COLORS = {
  light: { background: "#ffffff", border: "#e5e7eb", active: "#2563eb", inactive: "#6b7280" },
  dark: { background: "#111827", border: "#374151", active: "#60a5fa", inactive: "#9ca3af" },
} as const;

export default function TabsLayout(): ReactNode {
  const { resolved } = useTheme();
  const colors = TAB_COLORS[resolved];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.active,
        tabBarInactiveTintColor: colors.inactive,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen
        name="map"
        options={{
          title: "Map",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="map-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="logbook"
        options={{
          title: "Logbook",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="book-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
