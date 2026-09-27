"use client";

import { useId } from "react";

interface ComboboxOptions {
  /** Whether the suggestion list is rendered right now. */
  expanded: boolean;
  /** The arrow keys' cursor; -1 for none. */
  activeIndex: number;
  /** How many options the list holds. */
  count: number;
  /** The input's id, when the caller needs a fixed one; generated otherwise. */
  id?: string;
}

/**
 * The ARIA wiring of a suggestion dropdown — `StationSearchInput` and
 * `MapStationSearch` — written once so the two cannot drift.
 *
 * Focus never leaves the input (both lists `preventDefault` their pointerdown), so
 * the cursor can only be announced through `aria-activedescendant`, and the options
 * are out of the tab order. `aria-controls` and `aria-activedescendant` are set
 * only while the list is rendered: an IDREF naming an element that is not in the
 * document is a broken reference, not an empty one.
 */
export function useCombobox({ expanded, activeIndex, count, id }: ComboboxOptions) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listId = `${inputId}-results`;
  const optionId = (index: number) => `${inputId}-result-${index}`;

  return {
    inputId,
    inputProps: {
      id: inputId,
      role: "combobox",
      "aria-autocomplete": "list",
      "aria-expanded": expanded,
      "aria-controls": expanded ? listId : undefined,
      "aria-activedescendant":
        expanded && activeIndex >= 0 && activeIndex < count ? optionId(activeIndex) : undefined,
    } as const,
    // Only the id: the list writes `role="listbox"` itself, where Biome's a11y
    // rules can see it — through a spread, its `aria-label` reads as unsupported.
    listId,
    optionProps: (index: number) =>
      ({
        id: optionId(index),
        role: "option",
        "aria-selected": index === activeIndex,
        tabIndex: -1,
      }) as const,
  };
}
