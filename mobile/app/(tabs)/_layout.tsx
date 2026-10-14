/**
 * The three tabs the app is going to be: the map (Phase 3), the logbook (Phase 4),
 * and the settings that the web app keeps in its hamburger menu.
 *
 * The tab bar's colours are passed as values rather than class names — it is a native
 * view configured by props, so NativeWind has nothing to hook into (`theme/colors.ts`).
 */
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ReactNode } from "react";
import { useNativeColors } from "@/theme/colors";
import { ErrorScreen } from "@/ui/ErrorScreen";

/** Inside the providers, unlike the root's: a tab's crash leaves the session standing. */
export { ErrorScreen as ErrorBoundary };

export default function TabsLayout(): ReactNode {
  const { accent, tabBar } = useNativeColors();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: accent,
        tabBarInactiveTintColor: tabBar.inactive,
        tabBarStyle: { backgroundColor: tabBar.background, borderTopColor: tabBar.border },
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
