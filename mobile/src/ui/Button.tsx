/**
 * The named button roles, as `src/lib/ui/buttonStyles.ts` does on the web: one entry
 * per *role* rather than a string per button, so a state added here reaches every
 * button that plays that role. A call site adds layout only (`w-full`, `flex-1`).
 *
 * `active:` works here for the same reason it matters on the web — it is the only
 * press feedback a touch device gets — and NativeWind wires it to `Pressable`'s
 * pressed state. The 44pt floor from the web app's touch work is the default height.
 */
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text } from "react-native";

export type ButtonVariant = "primary" | "secondary" | "outline" | "danger" | "ghost";

const CONTAINER: Record<ButtonVariant, string> = {
  primary: "bg-blue-600 active:bg-blue-700",
  secondary: "bg-gray-200 active:bg-gray-300 dark:bg-gray-700 dark:active:bg-gray-600",
  outline:
    "border border-gray-300 bg-transparent active:bg-gray-100 dark:border-gray-600 dark:active:bg-gray-800",
  danger: "bg-red-600 active:bg-red-700",
  ghost: "bg-transparent active:bg-gray-100 dark:active:bg-gray-800",
};

const LABEL: Record<ButtonVariant, string> = {
  primary: "text-white",
  secondary: "text-gray-900 dark:text-gray-100",
  outline: "text-gray-900 dark:text-gray-100",
  danger: "text-white",
  ghost: "text-blue-600 dark:text-blue-400",
};

const SPINNER: Record<ButtonVariant, string> = {
  primary: "#ffffff",
  secondary: "#111827",
  outline: "#111827",
  danger: "#ffffff",
  ghost: "#2563eb",
};

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Shows a spinner in place of the label and blocks presses. */
  busy?: boolean;
  className?: string;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  busy = false,
  className = "",
}: ButtonProps): ReactNode {
  const inert = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inert, busy }}
      disabled={inert}
      onPress={onPress}
      className={`min-h-11 items-center justify-center rounded-xl px-4 ${CONTAINER[variant]} ${
        inert ? "opacity-50" : ""
      } ${className}`}
    >
      {busy ? (
        <ActivityIndicator color={SPINNER[variant]} />
      ) : (
        <Text className={`text-base font-semibold ${LABEL[variant]}`}>{label}</Text>
      )}
    </Pressable>
  );
}
