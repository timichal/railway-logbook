/**
 * The house input, as `src/lib/ui/inputStyles.ts` names it on the web — label, field
 * and error in one component, since every form in this app wants all three.
 */
import type { ReactNode, Ref } from "react";
import { Text, TextInput, type TextInputInstance, type TextInputProps, View } from "react-native";
import { useNativeColors } from "@/theme/colors";

interface TextFieldProps extends Omit<TextInputProps, "className"> {
  label: string;
  error?: string | null;
  hint?: string;
  /** The input's, so a form can move the focus on to it (`onSubmitEditing`). */
  ref?: Ref<TextInputInstance>;
}

export function TextField({ label, error, hint, ref, ...props }: TextFieldProps): ReactNode {
  const colors = useNativeColors();
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</Text>
      <TextInput
        ref={ref}
        // The platform keyboard picks its own colours from this, so it has to be set
        // rather than inherited: an unset one is dark-on-dark in dark mode.
        placeholderTextColor={colors.placeholder}
        // An error changes only the border: the field keeps its own background
        className={`min-h-11 rounded-xl border bg-white px-3 text-base text-gray-900 dark:bg-gray-800 dark:text-gray-100 ${
          error ? "border-red-500" : "border-gray-300 dark:border-gray-600"
        }`}
        {...props}
      />
      {hint && !error ? (
        <Text className="text-xs text-gray-500 dark:text-gray-400">{hint}</Text>
      ) : null}
      {error ? <Text className="text-xs text-red-600 dark:text-red-400">{error}</Text> : null}
    </View>
  );
}
