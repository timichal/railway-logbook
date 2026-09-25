/**
 * Light / System / Dark, as on the web (`ThemeSwitch` there).
 *
 * Three states because "follow the OS" is a real answer and the default one. The
 * preference is stored on the device rather than in `user_preferences`, for the same
 * reason the web app stores it in localStorage: it then needs no account, and it is
 * the *viewer's* choice.
 *
 * NativeWind is what actually applies it — `colorScheme.set()` drives the `dark:`
 * variants, `darkMode: "class"` in `tailwind.config.js` being what puts it under our
 * control rather than the OS's. `expo-system-ui` paints the window behind the React
 * tree, which is otherwise white for a frame during a cold start in dark mode; on
 * Android it is also what makes `userInterfaceStyle` take effect at all.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SystemUI from "expo-system-ui";
import { colorScheme, useColorScheme } from "nativewind";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "railwayLogbook.theme";

export type ThemePreference = "light" | "system" | "dark";
export type ResolvedTheme = "light" | "dark";

/** The window background behind the tree, per resolved scheme. */
const WINDOW_BACKGROUND: Record<ResolvedTheme, string> = {
  light: "#ffffff",
  dark: "#0b0f14",
};

interface ThemeValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference(next: ThemePreference): void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function isPreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const [preference, setStored] = useState<ThemePreference>("system");
  const { colorScheme: active } = useColorScheme();
  const resolved: ResolvedTheme = active === "dark" ? "dark" : "light";

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!isPreference(stored)) return;
        setStored(stored);
        colorScheme.set(stored);
      })
      .catch(() => {
        // Nothing to recover: "system" is the default and already applied.
      });
  }, []);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(WINDOW_BACKGROUND[resolved]);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setStored(next);
    colorScheme.set(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
