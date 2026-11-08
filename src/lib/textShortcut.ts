import type { KeyboardEvent } from "react";

/** An Alt+<key> shortcut that inserts `text` at the caret of an admin text input. */
export interface TextShortcut {
  /**
   * The physical key, as `KeyboardEvent.code` ("KeyJ"). Not `key`: on a Mac,
   * Option+letter types a composed character (Option+J is "∆", Option+E a dead accent).
   */
  code: string;
  text: string;
}

/** Station names: tags a route end that is a junction, not a station. */
export const JUNCTION_SHORTCUT: TextShortcut = { code: "KeyJ", text: " [junction]" };

/** Link names: fills in "EGTRE". */
export const EGTRE_SHORTCUT: TextShortcut = { code: "KeyE", text: "EGTRE" };

/**
 * Alt+`shortcut.code` inserts `shortcut.text` at the caret.
 *
 * At the caret rather than the end of the value, so text can go in wherever it
 * belongs, also into a value that already has some. `onValueChange` keeps the
 * controlled state in sync and the caret is restored after the inserted text.
 * Skipped mid-IME-composition, where the value isn't committed yet.
 */
export function handleTextShortcut(
  e: KeyboardEvent<HTMLInputElement>,
  shortcut: TextShortcut,
  onValueChange: (value: string) => void,
): void {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing || e.code !== shortcut.code)
    return;

  e.preventDefault();
  const input = e.currentTarget;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const next = input.value.slice(0, start) + shortcut.text + input.value.slice(end);
  const caret = start + shortcut.text.length;

  onValueChange(next);
  // The value comes back from React state, so the caret has to be re-applied after the re-render.
  requestAnimationFrame(() => {
    input.setSelectionRange(caret, caret);
  });
}
