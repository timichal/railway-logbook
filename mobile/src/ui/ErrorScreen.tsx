/**
 * What a route shows when something under it throws while rendering — expo-router's
 * `ErrorBoundary` export, in place of a white screen with no way back.
 *
 * **Provider-free on purpose.** The root layout's boundary wraps the root layout
 * itself, so it renders outside every provider: no theme context, no safe-area
 * context, no auth. So this uses only what works without them — NativeWind's
 * `dark:` (driven by a global the theme provider sets), `Screen` (whose
 * `SafeAreaView` is a native view that measures its own insets) and `Button` (whose
 * colours read NativeWind directly).
 *
 * All four edges are inset in both places it is used: `(tabs)`' boundary wraps the
 * tab navigator itself, so when it shows, the tab bar has gone with the rest.
 *
 * Retry re-renders the route from scratch; at the root that remounts the providers,
 * which is as close to restarting the app as an app can do to itself.
 */
import type { ErrorBoundaryProps } from "expo-router";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";

export function ErrorScreen({ error, retry }: ErrorBoundaryProps): ReactNode {
  return (
    <Screen>
      <View className="flex-1 justify-center gap-4 p-6">
        <Text className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Something went wrong
        </Text>
        <Text className="text-sm text-gray-600 dark:text-gray-400">
          This screen hit an error it could not recover from. Your logbook is safe — it is kept on
          the server.
        </Text>
        {/* The message is for a bug report, not an explanation: shown small, and only
            in a development build would it mean much to anyone. */}
        <Text selectable className="text-xs text-gray-500 dark:text-gray-500">
          {error.message}
        </Text>
        <Button label="Try again" onPress={() => void retry()} />
      </View>
    </Screen>
  );
}
