"use client";

import { useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import IconButton from "@/components/ui/IconButton";
import { filterByName } from "@/lib/searchText";
import { optionRow } from "@/lib/ui/buttonStyles";
import { useSearchCombobox } from "@/lib/ui/useSearchCombobox";

export interface TripOption {
  id: number;
  name: string;
}

interface TripPickerProps {
  /** The input's id, which the field's label points at. */
  id: string;
  /** The field's look, the same as the form's other inputs. */
  inputClassName: string;
  value: number | null;
  /** Most recent first, as the server lists them. */
  options: TripOption[];
  onChange: (tripId: number | null) => void;
}

/**
 * The trip a journey is filed under, picked by typing part of its name: a select
 * grew unwieldy past a couple dozen trips. The list is already in the browser,
 * so it is filtered here (`filterByName`) as each key is typed, and focusing the
 * field lists every trip, the most recent (the likeliest) first.
 *
 * The field shows the picked trip's name. What is typed is only a query: leaving
 * the field without picking puts the name back, and leaving it emptied files the
 * journey under no trip, as the × does.
 */
export default function TripPicker({
  id,
  inputClassName,
  value,
  options,
  onChange,
}: TripPickerProps) {
  const picked = options.find((option) => option.id === value) ?? null;
  // null while not typing: the field then shows the picked trip
  const [query, setQuery] = useState<string | null>(null);
  const text = query ?? picked?.name ?? "";
  // A click that focuses the field puts the caret down on its mouseup unless prevented
  const focusingClickRef = useRef(false);

  const combobox = useSearchCombobox<TripOption>({
    value: text,
    onChange: setQuery,
    // The picked name with nothing typed over it yet (the field just focused) is no
    // query: every trip is listed, so another can be picked without deleting it
    search: async (q) => (query === null ? options : filterByName(options, q)),
    onSelect: (trip) => {
      setQuery(null);
      onChange(trip.id);
    },
    onBlur: () => {
      if (query !== null && !query.trim()) onChange(null);
      setQuery(null);
    },
    id,
    local: true,
  });

  return (
    <div className="relative">
      <input
        {...combobox.inputProps}
        // Selected on focus, so typing replaces the name rather than appending to
        // it. Again a frame later, since iOS drops a selection made in the tap that
        // focuses, and the focusing click's mouseup is prevented, since WebKit puts
        // the caret down on it.
        onFocus={(e) => {
          combobox.inputProps.onFocus();
          const input = e.currentTarget;
          const name = input.value;
          input.select();
          // Not once typing has begun, which the selection would then swallow
          requestAnimationFrame(() => {
            if (document.activeElement === input && input.value === name) input.select();
          });
        }}
        onMouseDown={(e) => {
          focusingClickRef.current = document.activeElement !== e.currentTarget;
        }}
        onMouseUp={(e) => {
          if (focusingClickRef.current) e.preventDefault();
          focusingClickRef.current = false;
        }}
        placeholder="None · type to search your trips"
        autoComplete="off"
        className={`${inputClassName} ${picked ? "pr-9" : ""}`}
      />
      {picked && (
        <IconButton
          icon="close"
          label="File under no trip"
          title="No trip"
          onClick={() => {
            setQuery(null);
            onChange(null);
          }}
          size="sm"
          className="absolute right-2 top-1/2 -translate-y-1/2"
        />
      )}
      {combobox.expanded && (
        <div
          {...combobox.listProps}
          role="listbox"
          aria-label="Trips"
          className="absolute top-full mt-1 w-full bg-surface border border-gray-200 rounded shadow-lg max-h-60 overflow-y-auto z-20"
        >
          {combobox.results.map((trip, index) => (
            <button
              type="button"
              key={trip.id}
              {...combobox.optionProps(index)}
              className={`${optionRow(combobox.activeIndex === index)} px-3 py-2 text-sm border-b border-gray-100 last:border-b-0 flex items-center justify-between gap-2`}
            >
              <span className="truncate">{trip.name}</span>
              {trip.id === value && (
                <Icon name="check" className="w-4 h-4 text-blue-600 flex-shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
      {/* The filter is instant, so a list that just vanished would read as broken */}
      {combobox.focused &&
        query?.trim() &&
        combobox.results.length === 0 &&
        !combobox.isSearching && (
          <div
            role="status"
            className="absolute top-full mt-1 w-full bg-surface border border-gray-200 rounded shadow-lg px-3 py-2 text-sm text-gray-500 z-20"
          >
            No trip matches “{query.trim()}”
          </div>
        )}
    </div>
  );
}
