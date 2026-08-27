import { Link } from "expo-router";
import { type ReactNode, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { TextField } from "@/ui/TextField";

export default function LoginScreen(): ReactNode {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      // No navigation: the root layout's guard swaps the trees once the status
      // changes, so a screen that pushes here would be fighting it.
    } catch (caught) {
      setError(
        caught instanceof ApiError || caught instanceof Error
          ? caught.message
          : "Could not sign in.",
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
        <ScrollView contentContainerClassName="flex-grow justify-center gap-6 p-6">
          <View className="gap-2">
            <Text className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Railway Logbook
            </Text>
            <Text className="text-base text-gray-600 dark:text-gray-400">
              Sign in to see your map and log a ride.
            </Text>
          </View>

          <View className="gap-4">
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="next"
            />
            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />
            {error ? <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text> : null}
            <Button label="Sign in" onPress={() => void submit()} busy={busy} />
          </View>

          <View className="flex-row items-center justify-center gap-1">
            <Text className="text-sm text-gray-600 dark:text-gray-400">No account yet?</Text>
            <Link href="/register">
              <Text className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                Create one
              </Text>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
