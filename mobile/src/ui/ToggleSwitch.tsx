/**
 * A labelled switch row, as `ToggleSwitch` is on the web — except that the switch
 * itself is the platform's (`react-native`'s `Switch`), not a hand-built one. The web
 * app builds its own because a browser checkbox cannot be styled into this shape;
 * here the real control is the one people already know, and the row exists only to
 * give the label a hit area of its own.
 */
import type { ReactNode } from "react";
import { Pressable, Switch, Text, View } from "react-native";

interface ToggleSwitchProps {
  label: string;
  hint?: string;
  value: boolean;
  onChange(value: boolean): void;
}

export function ToggleSwitch({ label, hint, value, onChange }: ToggleSwitchProps): ReactNode {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => onChange(!value)}
      className="min-h-11 flex-row items-center gap-3 active:opacity-70"
    >
      <View className="flex-1 gap-0.5">
        <Text className="text-base text-gray-900 dark:text-gray-100">{label}</Text>
        {hint ? <Text className="text-xs text-gray-600 dark:text-gray-400">{hint}</Text> : null}
      </View>
      {/* The row above already answers to a press, so the switch itself is decorative
          for accessibility purposes — hence no second role on it. */}
      <Switch value={value} onValueChange={onChange} />
    </Pressable>
  );
}
