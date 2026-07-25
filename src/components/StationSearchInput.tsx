"use client";

import type { Station } from "@/lib/types";

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
  const input = (
    <div className={`relative ${containerClassName ?? ""}`}>
      <input
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
          className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
        >
          ×
        </button>
      )}
      {showResults && searchResults.length > 0 && (
        <div className="absolute top-full mt-1 w-full bg-white border border-gray-200 rounded shadow-lg max-h-60 overflow-y-auto z-20">
          {searchResults.map((station, index) => (
            <button
              type="button"
              key={station.id}
              onClick={() => onSelectResult(station)}
              onMouseEnter={() => onHoverResult(index)}
              className={`w-full px-3 py-2 text-left text-sm hover:bg-blue-50 border-b border-gray-100 last:border-b-0 ${
                selectedIndex === index ? "bg-blue-50" : ""
              }`}
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
