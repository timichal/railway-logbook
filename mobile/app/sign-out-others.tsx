/**
 * "Sign out other devices", as in the web menu: every other phone and browser
 * signed in to the account is signed out, and this one stays (`POST
 * /auth/sign-out-others`). For a phone lost or a computer left signed in.
 *
 * Confirmed by the password, as on the web: whoever held a stolen session could
 * otherwise sign the owner out and stay in. The server answers with a new pair for
 * this device, saved in place of the old one, which it refuses from then on
 * (`api.signOutOtherDevices`).
 *
 * A modal: spent, not left. On success it says so and offers Done, rather than
 * closing at once, because nothing else on screen would change to show it worked.
 * A request that never got a reply may still have gone through; this device is
 * then signed out with the rest at its next request, which the login screen
 * handles, so the message says to try again.
 */
import { useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { NetworkError } from "@/api/client";
import * as api from "@/api/endpoints";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { TextField } from "@/ui/TextField";

export default function SignOutOthersScreen(): ReactNode {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(): Promise<void> {
    if (!password) {
      setError("Enter your password to confirm.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.signOutOtherDevices(password);
      setDone(true);
    } catch (caught) {
      setError(
        caught instanceof NetworkError
          ? "Could not reach the server. Try again once you have a connection."
          : caught instanceof Error
            ? caught.message
            : "Could not sign out the other devices.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView contentContainerClassName="gap-6 p-6" keyboardShouldPersistTaps="handled">
          <View className="gap-3">
            <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Sign out other devices
            </Text>
            <Text className="text-base text-gray-700 dark:text-gray-300">
              {done
                ? "Every other phone and browser has been signed out. This one stays signed in."
                : "Signs your account out on every other phone and browser, for a lost phone or a computer left signed in. This one stays signed in."}
            </Text>
          </View>

          {done ? (
            <Button label="Done" onPress={() => router.back()} />
          ) : (
            <View className="gap-4">
              <TextField
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
                error={error}
              />
              <Button label="Sign out other devices" onPress={() => void submit()} busy={busy} />
              <Button
                label="Cancel"
                variant="outline"
                onPress={() => router.back()}
                disabled={busy}
              />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
