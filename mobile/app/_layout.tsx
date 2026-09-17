/**
 * The root layout: the providers, and the one navigation decision that depends on
 * them.
 *
 * `Stack.Protected` is what routes on auth state — the signed-out tree and the
 * signed-in tree are declared side by side and the guard decides which exists, so
 * there is no screen that redirects on mount and no window in which a protected
 * screen is briefly mounted. While the session is still being settled from the
 * keychain neither guard is true, and the splash screen stays up.
 */
import "../global.css";

import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { LayerPrefsProvider } from "@/map/LayerPrefsContext";
import { RegionProvider } from "@/region/RegionContext";
import { ThemeProvider, useTheme } from "@/theme/ThemeContext";

// The splash screen comes down once the session is settled, not on first render:
// otherwise a cold start shows the login screen for the moment the keychain read
// takes, and then replaces it with the map.
void SplashScreen.preventAutoHideAsync();

function RootNavigator(): ReactNode {
  const { status } = useAuth();
  const { resolved } = useTheme();

  useEffect(() => {
    if (status !== "loading") void SplashScreen.hideAsync();
  }, [status]);

  return (
    <>
      <StatusBar style={resolved === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={status === "signedIn"}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={status === "signedOut"}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout(): ReactNode {
  return (
    <GestureHandlerRootView className="flex-1">
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <RegionProvider>
              <LayerPrefsProvider>
                <RootNavigator />
              </LayerPrefsProvider>
            </RegionProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
