/**
 * Deleting the account — required by both stores for an app with sign-up (App
 * Store guideline 5.1.1(v), Google Play's account deletion policy), and the web
 * app's menu offers the same.
 *
 * Confirmed by the password and nothing else: typing it is already deliberate, and
 * a second "Are you sure?" would only be tapped through. The text says what goes,
 * because nothing comes back.
 *
 * Presented as a modal: it is spent, not left. On success there is no navigation
 * here — the session ends (`AuthContext.deleteAccount`), and the root layout's guard
 * swaps the signed-in tree, this screen included, for the login screen, which says
 * the account was deleted.
 *
 * A request that never got a reply may still have deleted the account, so a
 * connection failure says that rather than "failed". Trying again then either
 * deletes it or finds the session refused, which the login screen explains.
 */

import { useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { NetworkError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { TextField } from "@/ui/TextField";

export default function DeleteAccountScreen(): ReactNode {
  const router = useRouter();
  const { deleteAccount } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (!password) {
      setError("Enter your password to confirm.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await deleteAccount(password);
    } catch (caught) {
      setError(
        caught instanceof NetworkError
          ? "Could not reach the server, so the account may or may not have been deleted. Try again once you have a connection."
          : caught instanceof Error
            ? caught.message
            : "Could not delete the account.",
      );
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
              Delete account
            </Text>
            <Text className="text-base text-gray-700 dark:text-gray-300">
              This permanently deletes your account and everything in it: your journeys, trips and
              logged routes, your country selection, and your shared map link.
            </Text>
            <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
              It cannot be undone.
            </Text>
          </View>

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
            <Button
              label="Delete account permanently"
              variant="danger"
              onPress={() => void submit()}
              busy={busy}
            />
            <Button
              label="Cancel"
              variant="outline"
              onPress={() => router.back()}
              disabled={busy}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
