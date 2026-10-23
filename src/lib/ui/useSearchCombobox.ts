"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { MIN_SEARCH_QUERY_LENGTH, SEARCH_DEBOUNCE_MS } from "@/lib/shared/constants";
import { searchQueryLength } from "@/lib/shared/searchQuery";

/** Long enough for a click on a suggestion to land before the list goes. */
const BLUR_DELAY_MS = 200;

interface SearchComboboxOptions<T> {
  /** The text in the input; the caller owns it. */
  value: string;
  onChange: (value: string) => void;
  /**
   * The search behind the list. Read when a search starts, so it may be a new
   * function every render.
   */
  search: (query: string) => Promise<T[]>;
  /** A result chosen by click or Enter; the field is blurred after it. */
  onSelect: (result: T) => void;
  /** The input's id, when the caller needs a fixed one; generated otherwise. */
  id?: string;
  onFocus?: () => void;
  /** Called once the field has really been left: after the blur delay, and not at all when focus comes back first. */
  onBlur?: () => void;
}

/**
 * A search field with a suggestion dropdown — `StationSearchInput` and
 * `MapStationSearch` — written once so the two cannot drift: the debounce, the
 * two-character floor, the latest-request guard, the arrow keys' cursor, the blur
 * delay, and the ARIA combobox wiring.
 *
 * Focus never leaves the input: the list `preventDefault`s its pointerdown
 * (`listProps`), which suppresses the focus change, so the blur timer cannot fire and
 * hide the list before the click lands — on touch, even starting to *scroll* the list
 * used to close it. Scrolling is unaffected (that is `touch-action`'s business) and
 * `click` still fires after a prevented pointerdown. Hence the cursor can only be
 * announced through `aria-activedescendant`, the options are out of the tab order,
 * and choosing a result blurs the input itself, or the keyboard would stay up over
 * the map. `aria-controls` and `aria-activedescendant` are set only while the list
 * is rendered: an IDREF naming an element that is not in the document is a broken
 * reference, not an empty one.
 *
 * The list shows only while the field is focused, so of several fields at most one
 * has a list open; leaving the field drops its results, and coming back searches
 * again.
 */
export function useSearchCombobox<T>({
  value,
  onChange,
  search,
  onSelect,
  id,
  onFocus,
  onBlur,
}: SearchComboboxOptions<T>) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listId = `${inputId}-results`;
  const optionId = (index: number) => `${inputId}-result-${index}`;

  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<T[]>([]);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the latest request may write, so a slow answer to an older query never
  // replaces a newer one's, nor stops the spinner while the newer one runs
  const requestRef = useRef(0);
  // The latest `search`, so a debounced request sent after a re-render uses it
  const searchRef = useRef(search);
  useLayoutEffect(() => {
    searchRef.current = search;
  });

  const expanded = focused && results.length > 0;

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

  // Drops a search still debouncing or in flight along with the list
  const clearResults = () => {
    cancelDebounce();
    requestRef.current++;
    setResults([]);
    setActiveIndex(-1);
    setIsSearching(false);
  };

  // A value set from outside (a station picked on the map, a region switch, the
  // parent's ×) drops a search still running for the text typed before it, which
  // would otherwise open a list that no longer matches the field
  const typedRef = useRef(value);
  // biome-ignore lint/correctness/useExhaustiveDependencies: value is the trigger; the rest are refs and setters.
  useEffect(() => {
    if (value === typedRef.current) return;
    typedRef.current = value;
    clearResults();
  }, [value]);

  const runSearch = async (query: string) => {
    const requestId = ++requestRef.current;
    setIsSearching(true);
    try {
      const found = await searchRef.current(query);
      if (requestId !== requestRef.current) return;
      setResults(found);
      setActiveIndex(-1);
    } catch (error) {
      if (requestId !== requestRef.current) return;
      console.error("Search failed:", error);
      setResults([]);
    } finally {
      if (requestId === requestRef.current) setIsSearching(false);
    }
  };

  const handleChange = (next: string) => {
    typedRef.current = next;
    onChange(next);
    if (searchQueryLength(next) >= MIN_SEARCH_QUERY_LENGTH) {
      // The list still showing answers the old text: a request for that text still
      // in flight must not replace it, and Enter must not pick a row arrowed to then
      cancelDebounce();
      requestRef.current++;
      setIsSearching(false);
      setActiveIndex(-1);
      debounceRef.current = setTimeout(() => runSearch(next), SEARCH_DEBOUNCE_MS);
    } else {
      clearResults();
    }
  };

  const handleFocus = () => {
    // Back inside the blur delay: the list was never dropped and is still current
    const returning = blurRef.current !== null;
    cancelTimers();
    setFocused(true);
    if (!returning) {
      setActiveIndex(-1);
      if (searchQueryLength(value) >= MIN_SEARCH_QUERY_LENGTH) runSearch(value);
    }
    onFocus?.();
  };

  const handleBlur = () => {
    cancelTimers();
    blurRef.current = setTimeout(() => {
      blurRef.current = null;
      setFocused(false);
      clearResults();
      onBlur?.();
    }, BLUR_DELAY_MS);
  };

  const select = (result: T) => {
    onSelect(result);
    clearResults();
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Even with no list showing: a search still debouncing or in flight would open one
    if (e.key === "Escape") {
      clearResults();
      return;
    }
    if (!expanded) return;
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
        if (activeIndex >= 0 && activeIndex < results.length) select(results[activeIndex]);
        break;
    }
  };

  return {
    inputId,
    results,
    activeIndex,
    expanded,
    isSearching,
    inputProps: {
      ref: inputRef,
      id: inputId,
      type: "text",
      role: "combobox",
      "aria-autocomplete": "list",
      "aria-expanded": expanded,
      "aria-controls": expanded ? listId : undefined,
      "aria-activedescendant":
        expanded && activeIndex >= 0 && activeIndex < results.length
          ? optionId(activeIndex)
          : undefined,
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => handleChange(e.target.value),
      onKeyDown: handleKeyDown,
      onFocus: handleFocus,
      onBlur: handleBlur,
    } as const,
    // No `role` here: the list writes `role="listbox"` itself, where Biome's a11y
    // rules can see it — through a spread, its `aria-label` reads as unsupported.
    listProps: {
      id: listId,
      onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
    },
    optionProps: (index: number) =>
      ({
        id: optionId(index),
        role: "option",
        "aria-selected": index === activeIndex,
        tabIndex: -1,
        onClick: () => select(results[index]),
        onMouseEnter: () => setActiveIndex(index),
      }) as const,
  };
}
