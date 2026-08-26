"use client";

import { useRef } from "react";
import type { Station } from "@/lib/types";
import { iconBtn, optionRow } from "@/lib/ui/buttonStyles";

interface StationSearchInputProps {
  /** Optional id for the input (used to associate the label). */
  id?: string;
  /** Optional label rendered above the input. */
  label?: string;
  /** Current text in the input. */
  value: string;
  placeholder: string;
  /** Whether a station is currently selected (drives the highlighted border). */
  isSelected: boolean;
  /** Tailwind classes applied to the input when a station is selected. */
  selectedClassName: string;
  /** Whether this input's results dropdown should be shown. */
  showResults: boolean;
  /** Shared search results (only rendered when showResults is true). */
  searchResults: Station[];
  /** Index of the keyboard-highlighted result. */
  selectedIndex: number;
  /** Extra classes for the positioning wrapper (e.g. "flex-1" for via rows). */
  containerClassName?: string;
  /** Whether to render the clear/remove (×) button. */
  showClear: boolean;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  onSelectResult: (station: Station) => void;
  onHoverResult: (index: number) => void;
  onClear: () => void;
}

/**
 * A single station search field: text input, clear button, and results dropdown.
 * Presentational only — the parent owns all search state (active field, results,
 * highlighted index) so that a single dropdown is open across the from/via/to
 * inputs at any time.
 */
export default function StationSearchInput({
  id,
  label,
  value,
  placeholder,
  isSelected,
  selectedClassName,
  showResults,
  searchResults,
  selectedIndex,
  containerClassName,
  showClear,
  onChange,
  onKeyDown,
  onFocus,
  onBlur,
  onSelectResult,
  onHoverResult,
  onClear,
}: StationSearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // The dropdown deliberately never takes focus off the input: `preventDefault` on
  // pointerdown suppresses the focus change (and the compat mousedown with it), so
  // the parent's blur timer cannot fire and hide the list before the click lands.
  // That timer was the "tapped it, nothing happened" bug — on touch, even starting
  // to *scroll* the list blurred the field and closed it 200ms later. Scrolling is
  // unaffected (that is `touch-action`'s business, not the default action here), and
  // `click` still fires after a prevented pointerdown, so selection is unchanged.
  const keepFocus = (e: React.PointerEvent) => e.preventDefault();

  // Focus is ours to give back: with the blur suppressed the keyboard would stay up
  // over the map after a station is chosen.
  const selectResult = (station: Station) => {
    onSelectResult(station);
    inputRef.current?.blur();
  };

  const input = (
    <div className={`relative ${containerClassName ?? ""}`}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        className={`w-full px-3 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          isSelected ? selectedClassName : "border-gray-300"
        }`}
      />
      {showClear && (
        <button
          type="button"
          onClick={onClear}
          className={`${iconBtn("sm")} absolute right-2 top-1/2 -translate-y-1/2`}
        >
          ×
        </button>
      )}
      {showResults && searchResults.length > 0 && (
        <div
          onPointerDown={keepFocus}
          className="absolute top-full mt-1 w-full bg-white border border-gray-200 rounded shadow-lg max-h-60 overflow-y-auto z-20"
        >
          {searchResults.map((station, index) => (
            <button
              type="button"
              key={station.id}
              onClick={() => selectResult(station)}
              onMouseEnter={() => onHoverResult(index)}
              className={`${optionRow(selectedIndex === index)} px-3 py-2 text-sm border-b border-gray-100 last:border-b-0`}
            >
              {station.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  if (!label) return input;

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium mb-1">
        {label}
      </label>
      {input}
    </div>
  );
}
