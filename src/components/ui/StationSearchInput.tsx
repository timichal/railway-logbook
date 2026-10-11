"use client";

import { useRegionId } from "@/lib/regionContext";
import type { Station } from "@/lib/shared/types";
import { iconBtn, optionRow } from "@/lib/ui/buttonStyles";
import { useSearchCombobox } from "@/lib/ui/useSearchCombobox";
import { searchStations } from "@/lib/userActions";

interface StationSearchInputProps {
  /** Optional id for the input; one is generated otherwise. */
  id?: string;
  /** The field's name: shown above the input, or — with `hideLabel` — only read out. */
  label: string;
  /** Leave the label to screen readers, for a row whose position already says it. */
  hideLabel?: boolean;
  /** Current text in the input. */
  value: string;
  placeholder: string;
  /** Whether a station is currently selected (drives the highlighted border). */
  isSelected: boolean;
  /** Tailwind classes applied to the input when a station is selected. */
  selectedClassName: string;
  /** Extra classes for the positioning wrapper (e.g. "flex-1" for via rows). */
  containerClassName?: string;
  /** What the × does, for screen readers: in a via row it deletes the stop, not the text. */
  clearLabel: string;
  onChange: (value: string) => void;
  onSelect: (station: Station) => void;
  /** Renders the × when given. */
  onClear?: () => void;
  onFocus?: () => void;
  /** Called once the field has really been left, with the list (see `useSearchCombobox`). */
  onBlur?: () => void;
}

/**
 * A single station search field: text input, clear button, and a suggestion
 * dropdown of the region's stations. The parent owns the text and the picked
 * station; the field owns its search (`useSearchCombobox`) and shows its dropdown
 * only while focused, so of several fields at most one has a list open.
 */
export default function StationSearchInput({
  id,
  label,
  hideLabel = false,
  value,
  placeholder,
  isSelected,
  selectedClassName,
  containerClassName,
  clearLabel,
  onChange,
  onSelect,
  onClear,
  onFocus,
  onBlur,
}: StationSearchInputProps) {
  const regionId = useRegionId();
  const combobox = useSearchCombobox({
    value,
    onChange,
    search: (query) => searchStations(query, regionId),
    onSelect,
    id,
    onFocus,
    onBlur,
  });

  const input = (
    <div className={`relative ${containerClassName ?? ""}`}>
      <input
        {...combobox.inputProps}
        aria-label={hideLabel ? label : undefined}
        placeholder={placeholder}
        className={`w-full px-3 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          isSelected ? selectedClassName : "border-gray-300"
        }`}
      />
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          className={`${iconBtn("sm")} absolute right-2 top-1/2 -translate-y-1/2`}
        >
          ×
        </button>
      )}
      {combobox.expanded && (
        <div
          {...combobox.listProps}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute top-full mt-1 w-full bg-surface border border-gray-200 rounded shadow-lg max-h-60 overflow-y-auto z-20"
        >
          {combobox.results.map((station, index) => (
            <button
              type="button"
              key={station.id}
              {...combobox.optionProps(index)}
              className={`${optionRow(combobox.activeIndex === index)} px-3 py-2 text-sm border-b border-gray-100 last:border-b-0`}
            >
              {station.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  if (hideLabel) return input;

  return (
    <div>
      <label htmlFor={combobox.inputId} className="block text-xs font-medium mb-1">
        {label}
      </label>
      {input}
    </div>
  );
}
