"use client";

import { useEffect, useRef, useState } from "react";
import { useRegionId } from "@/lib/regionContext";
import type { Station } from "@/lib/shared/types";
import { iconBtn, optionRow } from "@/lib/ui/buttonStyles";
import { useCombobox } from "@/lib/ui/useCombobox";
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
  /**
   * Called once the field has really been left: 200ms after the blur, with the list,
   * and not at all when focus comes back first.
   */
  onBlur?: () => void;
}

/**
 * A single station search field: text input, clear button, and a suggestion
 * dropdown of the region's stations. The parent owns the text and the picked
 * station; the field owns its search — debounce, results, the arrow keys' cursor —
 * and shows its dropdown only while focused, so of several fields at most one has
 * a list open.
 *
 * An ARIA combobox (`useCombobox`): focus never leaves the input (see `keepFocus`),
 * so the arrow keys' cursor is announced rather than moved onto the options.
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<Station[]>([]);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the latest request may write, so a slow answer to an older query never
  // replaces a newer one's
  const requestRef = useRef(0);

  const expanded = focused && results.length > 0;
  const combobox = useCombobox({ expanded, activeIndex, count: results.length, id });

  const cancelDebounce = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
  };
  const cancelTimers = () => {
    cancelDebounce();
    if (blurRef.current) clearTimeout(blurRef.current);
    blurRef.current = null;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount only; the timers live in refs.
  useEffect(() => cancelTimers, []);

  const clearResults = () => {
    requestRef.current++;
    setResults([]);
    setActiveIndex(-1);
  };

  // A value set from outside (a station picked on the map, the parent's ×) drops a
  // search still running for the text typed before it, which would otherwise open a
  // list that no longer matches the field
  const typedRef = useRef(value);
  // biome-ignore lint/correctness/useExhaustiveDependencies: value is the trigger; the rest are refs and setters.
  useEffect(() => {
    if (value === typedRef.current) return;
    typedRef.current = value;
    cancelDebounce();
    clearResults();
  }, [value]);

  const search = async (query: string) => {
    const requestId = ++requestRef.current;
    try {
      const stations = await searchStations(query, regionId);
      if (requestId !== requestRef.current) return;
      setResults(stations);
      setActiveIndex(-1);
    } catch (error) {
      if (requestId !== requestRef.current) return;
      console.error("Error searching stations:", error);
      setResults([]);
    }
  };

  const handleChange = (next: string) => {
    typedRef.current = next;
    onChange(next);
    cancelDebounce();
    if (next.trim().length >= 2) {
      debounceRef.current = setTimeout(() => search(next), 300);
    } else {
      clearResults();
    }
  };

  const handleFocus = () => {
    cancelTimers();
    setFocused(true);
    setActiveIndex(-1);
    if (value.trim().length >= 2) search(value);
    onFocus?.();
  };

  // Delayed so a click on a suggestion lands first; a search still debouncing is
  // dropped rather than answered into a closed list.
  const handleBlur = () => {
    cancelTimers();
    blurRef.current = setTimeout(() => {
      setFocused(false);
      clearResults();
      onBlur?.();
    }, 200);
  };

  // The dropdown deliberately never takes focus off the input: `preventDefault` on
  // pointerdown suppresses the focus change (and the compat mousedown with it), so
  // the blur timer cannot fire and hide the list before the click lands. That timer
  // was the "tapped it, nothing happened" bug — on touch, even starting to *scroll*
  // the list blurred the field and closed it 200ms later. Scrolling is unaffected
  // (that is `touch-action`'s business, not the default action here), and `click`
  // still fires after a prevented pointerdown, so selection is unchanged.
  const keepFocus = (e: React.PointerEvent) => e.preventDefault();

  // Focus is ours to give back: with the blur suppressed the keyboard would stay up
  // over the map after a station is chosen.
  const selectResult = (station: Station) => {
    onSelect(station);
    clearResults();
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Even with no list showing: a search still debouncing or in flight would open one
    if (e.key === "Escape") {
      cancelDebounce();
      clearResults();
      return;
    }
    if (results.length === 0) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < results.length) selectResult(results[activeIndex]);
        break;
    }
  };

  const input = (
    <div className={`relative ${containerClassName ?? ""}`}>
      <input
        ref={inputRef}
        {...combobox.inputProps}
        type="text"
        aria-label={hideLabel ? label : undefined}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
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
      {expanded && (
        <div
          id={combobox.listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          onPointerDown={keepFocus}
          className="absolute top-full mt-1 w-full bg-surface border border-gray-200 rounded shadow-lg max-h-60 overflow-y-auto z-20"
        >
          {results.map((station, index) => (
            <button
              type="button"
              key={station.id}
              {...combobox.optionProps(index)}
              onClick={() => selectResult(station)}
              onMouseEnter={() => setActiveIndex(index)}
              className={`${optionRow(activeIndex === index)} px-3 py-2 text-sm border-b border-gray-100 last:border-b-0`}
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
