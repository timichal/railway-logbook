"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { INPUT } from "@/components/admin/TextField";
import { plural } from "@/lib/plural";
import { btn, filterChip, optionRow, segmentBtn } from "@/lib/ui/buttonStyles";

export interface FilterChipOption {
  key: string;
  label: string;
  /** Items matching the filter, out of the whole list. */
  count: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

interface AdminListProps<T> {
  /** Above everything else in the header: the Routes / Scenic switch. */
  toolbar?: ReactNode;
  filters: FilterChipOption[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchPlaceholder: string;
  /** The singular noun for the count line ("route", "scenic line"). */
  noun: string;
  /** Every item, before filters and search. */
  total: number;
  /** One page of the filtered list (`usePagedList`). */
  items: T[];
  filteredCount: number;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  getKey: (item: T) => number;
  selectedKey: number | null;
  onItemClick: (item: T) => void;
  renderItem: (item: T) => ReactNode;
  isLoading: boolean;
  /** Shown when nothing is listed and nothing is loading. */
  emptyText: string;
}

/**
 * The left half of the admin's Routes tab, for routes and scenic lines alike: the
 * switch between them, the filter chips, the search box, the rows and the pagination.
 * What a row shows and what selecting one does are the caller's.
 */
export default function AdminList<T>({
  toolbar,
  filters,
  searchQuery,
  onSearchChange,
  searchPlaceholder,
  noun,
  total,
  items,
  filteredCount,
  currentPage,
  totalPages,
  onPageChange,
  getKey,
  selectedKey,
  onItemClick,
  renderItem,
  isLoading,
  emptyText,
}: AdminListProps<T>) {
  const narrowed = filteredCount !== total;

  // Bring the selected row into view: one picked on the map may sit far down the
  // page, out of sight. Again once the rows change, for one selected meanwhile.
  const selectedRowRef = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedKey and items are the triggers; the row is read through its ref.
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedKey, items]);

  return (
    <div className="flex-1 min-w-0 border-r border-gray-200 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-gray-100 flex-shrink-0 space-y-2">
        {toolbar}
        {filters.length > 0 && <FilterChips filters={filters} />}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className={INPUT}
        />
        <div className="text-xs text-gray-500">
          {narrowed ? `${filteredCount} of ${plural(total, noun)}` : plural(total, noun)}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-center text-gray-500">Loading...</div>
        ) : items.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500">
            {total === 0 ? emptyText : "No match."}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((item) => {
              const key = getKey(item);
              const selected = key === selectedKey;
              return (
                <button
                  type="button"
                  key={key}
                  ref={selected ? selectedRowRef : undefined}
                  onClick={() => onItemClick(item)}
                  className={`${optionRow(selected)} p-3`}
                >
                  {renderItem(item)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="border-t border-gray-100 flex-shrink-0 p-3 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className={btn("outline", "sm")}
          >
            Previous
          </button>
          <span className="text-gray-600">
            {currentPage}/{totalPages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className={btn("outline", "sm")}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The list filters as toggle chips with their counts. One matching nothing is
 * dimmed rather than hidden, so the row doesn't reflow as the counts change.
 */
function FilterChips({ filters }: { filters: FilterChipOption[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {filters.map((filter) => (
        <button
          key={filter.key}
          type="button"
          aria-pressed={filter.checked}
          onClick={() => filter.onChange(!filter.checked)}
          className={filterChip(filter.checked, filter.count === 0)}
        >
          {filter.label}
          <span className={`tabular-nums ${filter.checked ? "text-white/80" : "text-gray-500"}`}>
            {filter.count}
          </span>
        </button>
      ))}
    </div>
  );
}

/** What the Routes tab lists, and what the map is set up for (see `AdminPageClient`). */
export type AdminListKind = "routes" | "scenic";

const KINDS: { id: AdminListKind; label: string }[] = [
  { id: "routes", label: "Routes" },
  { id: "scenic", label: "Scenic" },
];

/** The Routes / Scenic switch heading the list, where the region has scenic lines. */
export function AdminListKindSwitch({
  kind,
  onChange,
}: {
  kind: AdminListKind;
  onChange: (kind: AdminListKind) => void;
}) {
  return (
    <fieldset
      className="flex w-full rounded-md border border-gray-300 overflow-hidden"
      aria-label="List"
    >
      {KINDS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={kind === id}
          onClick={() => onChange(id)}
          className={segmentBtn(kind === id)}
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}

const ITEMS_PER_PAGE = 100;

/**
 * Pages a filtered list. `resetKey` is what sends it back to page 1 (the search and
 * the ticked filters), not the list itself: a save patching one row must not.
 *
 * A newly selected item turns to its page, so one picked on the map is in view
 * (`AdminList` then scrolls to its row). Only once it is listed: a selection made
 * before the list loads, or hidden by a filter, turns to its page when it shows up.
 */
export function usePagedList<T>(
  filtered: T[],
  resetKey: unknown,
  getKey: (item: T) => number,
  selectedKey: number | null,
) {
  const [requestedPage, setCurrentPage] = useState(1);
  const [pagedFor, setPagedFor] = useState(resetKey);
  if (pagedFor !== resetKey) {
    setPagedFor(resetKey);
    setCurrentPage(1);
  }

  const [turnedFor, setTurnedFor] = useState<number | null>(null);
  if (selectedKey !== turnedFor) {
    const index = selectedKey === null ? -1 : filtered.findIndex((i) => getKey(i) === selectedKey);
    if (selectedKey === null || index >= 0) setTurnedFor(selectedKey);
    if (index >= 0) setCurrentPage(Math.floor(index / ITEMS_PER_PAGE) + 1);
  }

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  // A list that shrank under the page (its last row deleted) shows its new last page
  const currentPage = Math.min(requestedPage, Math.max(totalPages, 1));
  const items = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filtered.slice(start, start + ITEMS_PER_PAGE);
  }, [filtered, currentPage]);
  return { items, currentPage, totalPages, setCurrentPage };
}
