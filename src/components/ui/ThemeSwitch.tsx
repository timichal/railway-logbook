"use client";

import { setThemePreference, type ThemePreference, useThemePreference } from "@/lib/theme";
import { iconBtn } from "@/lib/ui/buttonStyles";

/**
 * Light / System / Dark, as a segmented control shaped like `RegionSwitch`.
 *
 * Three states rather than a two-way toggle because "follow the OS" is a real answer
 * and the default one — a phone that turns dark at sunset should take the app with
 * it. It is not shared as a `ToggleSwitch` row with the layer switches beside it for
 * that reason: a switch can only say on or off.
 *
 * The choice is localStorage-only (see `src/lib/theme`), so it applies to this
 * browser and needs no account — which is also what makes the shared map follow the
 * visitor rather than the owner.
 */
const OPTIONS: { value: ThemePreference; label: string; icon: string }[] = [
  // Sun.
  {
    value: "light",
    label: "Light",
    icon: "M12 3v2m0 14v2m9-9h-2M5 12H3m14.66-6.66l-1.42 1.42M7.76 16.24l-1.42 1.42m12.32 0l-1.42-1.42M7.76 7.76L6.34 6.34M16 12a4 4 0 11-8 0 4 4 0 018 0z",
  },
  // A display, for "whatever this device says".
  {
    value: "system",
    label: "System",
    icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  },
  // Moon.
  { value: "dark", label: "Dark", icon: "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" },
];

interface ThemeSwitchProps {
  /**
   * Icon-only segments in a strip of their own width, for the admin bar beside the
   * region switch (whose height it matches). The menu's is labelled and full-width.
   */
  compact?: boolean;
}

export default function ThemeSwitch({ compact = false }: ThemeSwitchProps) {
  const preference = useThemePreference();

  return (
    <fieldset
      className={`h-10 rounded-md border border-gray-300 overflow-hidden ${
        compact ? "inline-flex" : "flex w-full"
      }`}
      aria-label="Colour scheme"
    >
      {OPTIONS.map((option) => {
        const isActive = option.value === preference;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setThemePreference(option.value)}
            aria-pressed={isActive}
            aria-label={compact ? option.label : undefined}
            title={compact ? option.label : undefined}
            // The fieldset clips to round the strip's ends, so the base focus ring —
            // drawn 2px outside the segment — would be invisible. Inset it, as
            // RegionSwitch does for the same reason.
            className={`${compact ? "px-3" : "flex-1 px-2"} inline-flex items-center justify-center gap-1.5 text-sm font-medium transition-colors focus-visible:-outline-offset-2 border-r border-gray-300 last:border-r-0 ${
              isActive
                ? "bg-blue-600 text-white"
                : "bg-surface text-gray-600 hover:bg-gray-100 hover:text-gray-900 active:bg-gray-200"
            }`}
          >
            <svg
              className="w-4 h-4 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d={option.icon}
              />
            </svg>
            {!compact && option.label}
          </button>
        );
      })}
    </fieldset>
  );
}

/**
 * The same setting as one 44pt bar button that steps Light → System → Dark, showing
 * the current choice — for the admin page's phone bar, which has no menu to hold the
 * switch and no room for three more targets beside the region switch.
 */
export function ThemeCycleButton() {
  const preference = useThemePreference();
  const index = OPTIONS.findIndex((option) => option.value === preference);
  const current = OPTIONS[index];
  const next = OPTIONS[(index + 1) % OPTIONS.length];

  return (
    <button
      type="button"
      onClick={() => setThemePreference(next.value)}
      className={iconBtn("md")}
      aria-label={`Colour scheme: ${current.label}. Switch to ${next.label}`}
      title={`Colour scheme: ${current.label}`}
    >
      <svg
        className="w-6 h-6"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={current.icon} />
      </svg>
    </button>
  );
}
