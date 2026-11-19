import { Link } from "expo-router";
import { type ReactNode, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  type TextInputInstance,
  View,
} from "react-native";
import { ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { TextField } from "@/ui/TextField";

export default function RegisterScreen(): ReactNode {
  const { signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);
  const confirmRef = useRef<TextInputInstance>(null);

  async function submit(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      // The password rules are the server's, and it returns the message the web form
      // would show (a 400, per `API.md`) — so nothing is validated twice here.
      await signUp({ name: name.trim() || undefined, email, password, confirmPassword });
    } catch (caught) {
      setError(
        caught instanceof ApiError || caught instanceof Error
          ? caught.message
          : "Could not create the account.",
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
              Create account
            </Text>
            <Text className="text-base text-gray-600 dark:text-gray-400">
              Your journeys are kept under this account.
            </Text>
          </View>

          <View className="gap-4">
            <TextField
              label="Name"
              hint="Optional — shown when you are signed in."
              value={name}
              onChangeText={setName}
              autoComplete="name"
              returnKeyType="next"
              // "submit" keeps the keyboard up while the focus moves on
              submitBehavior="submit"
              onSubmitEditing={() => emailRef.current?.focus()}
            />
            <TextField
              ref={emailRef}
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            <TextField
              ref={passwordRef}
              label="Password"
              // As the web's form says it; the server enforces it (`authQueries.ts`)
              hint="At least 6 characters."
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => confirmRef.current?.focus()}
            />
            <TextField
              ref={confirmRef}
              label="Confirm password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />
            {error ? <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text> : null}
            <Button label="Create account" onPress={() => void submit()} busy={busy} />
          </View>

          <View className="flex-row items-center justify-center gap-1">
            <Text className="text-sm text-gray-600 dark:text-gray-400">Already have one?</Text>
            <Link href="/login">
              <Text className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                Sign in
              </Text>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
