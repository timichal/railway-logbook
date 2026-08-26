"use client";

interface ToggleSwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Tighter track and row, for the map's cramped overlay boxes. */
  compact?: boolean;
}

/**
 * On/off switch for the map's layer toggles.
 *
 * A `role="switch"` button rather than a styled `<input type="checkbox">`: the whole
 * row is the hit area (44pt on touch, `md:`-reset for desktop density), and there is
 * no native box to hide and re-draw. Screen readers get the same semantics either way.
 *
 * It carries no `hover:`/`active:` styling, unlike every other control in the app: the
 * knob slides and the track changes colour the instant it is pressed, which is louder
 * feedback than a background tint, and a hover tint on a row this wide reads as a
 * selection rather than a target. Focus still comes from the `globals.css` base rule.
 */
export default function ToggleSwitch({
  label,
  checked,
  onChange,
  compact = false,
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`w-full flex items-center justify-between gap-3 text-left text-gray-900 min-h-11 md:min-h-0 ${
        compact ? "text-xs md:py-0.5" : "text-sm py-1"
      }`}
    >
      <span>{label}</span>
      {/* Padded track + translate on the knob, so the travel is an integer spacing
          step (track - 2×padding - knob) and needs no fractional utilities. */}
      <span
        aria-hidden="true"
        className={`flex-shrink-0 flex items-center rounded-full p-0.5 transition-colors ${
          compact ? "w-9 h-5" : "w-11 h-6"
        } ${checked ? "bg-blue-600" : "bg-gray-300"}`}
      >
        <span
          className={`rounded-full bg-white shadow transition-transform ${
            compact ? "w-4 h-4" : "w-5 h-5"
          } ${checked ? (compact ? "translate-x-4" : "translate-x-5") : "translate-x-0"}`}
        />
      </span>
    </button>
  );
}
