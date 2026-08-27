/**
 * The region and theme switches, as `RegionSwitch` / `ThemeSwitch` are on the web:
 * a short list of mutually exclusive options, all visible, the current one filled.
 */
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange(value: T): void;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: SegmentedControlProps<T>): ReactNode {
  return (
    <View
      className={`flex-row rounded-xl bg-gray-200 p-1 dark:bg-gray-700 ${className}`}
      accessibilityRole="radiogroup"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            className={`min-h-11 flex-1 items-center justify-center rounded-lg px-3 ${
              selected ? "bg-white dark:bg-gray-900" : "active:bg-gray-300 dark:active:bg-gray-600"
            }`}
          >
            <Text
              className={`text-sm ${
                selected
                  ? "font-semibold text-gray-900 dark:text-gray-100"
                  : "text-gray-600 dark:text-gray-300"
              }`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
