/**
 * Colours as values, per scheme, for the places NativeWind cannot reach.
 *
 * A `dark:` class reaches anything styled by `className`, but an icon's `color`, an
 * `ActivityIndicator`'s `color`, a `placeholderTextColor` and the tab bar's tints are
 * props, read as plain values. A fixed hex there is right in one scheme and invisible
 * in the other (a `#111827` spinner on a `gray-900` screen), so each such value is
 * named once here, in both schemes, and read through `useNativeColors`.
 *
 * The hexes are Tailwind's gray and blue ramps, matching the classes beside them.
 */
import { useColorScheme } from "nativewind";
import type { ResolvedTheme } from "@/theme/ThemeContext";

export interface NativeColors {
  /** A secondary icon: close ×, chevrons, a row's leading glyph. */
  icon: string;
  /** An icon that is the whole of its button (the map's round buttons). */
  iconStrong: string;
  placeholder: string;
  /** Body text — a spinner standing in for a label. */
  text: string;
  /** The accent: a ghost button's label, the active tab. */
  accent: string;
  tabBar: { background: string; border: string; inactive: string };
}

export const NATIVE_COLORS: Record<ResolvedTheme, NativeColors> = {
  light: {
    icon: "#6b7280",
    iconStrong: "#374151",
    placeholder: "#9ca3af",
    text: "#111827",
    accent: "#2563eb",
    tabBar: { background: "#ffffff", border: "#e5e7eb", inactive: "#6b7280" },
  },
  dark: {
    icon: "#9ca3af",
    iconStrong: "#e5e7eb",
    placeholder: "#6b7280",
    text: "#f3f4f6",
    accent: "#60a5fa",
    tabBar: { background: "#111827", border: "#374151", inactive: "#9ca3af" },
  },
};

/**
 * Read from NativeWind's scheme rather than `useTheme`, which resolves from the same
 * place: this way it needs no provider, so the root error boundary — rendered outside
 * every provider — can still draw a `Button`.
 */
export function useNativeColors(): NativeColors {
  return NATIVE_COLORS[useColorScheme().colorScheme === "dark" ? "dark" : "light"];
}
