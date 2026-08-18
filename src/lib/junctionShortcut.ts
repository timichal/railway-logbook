import type { KeyboardEvent } from "react";

/** Suffix admins tag a station name with when the route ends at a junction, not a station. */
export const JUNCTION_SUFFIX = " [junction]";

/**
 * Alt+J inserts `JUNCTION_SUFFIX` at the caret of a station-name input.
 *
 * The caret rather than the end of the value, so a name that already carries a
 * suffix can still be tagged; `onValueChange` keeps the controlled state in sync
 * and the caret is restored after the inserted text.
 */
export function handleJunctionShortcut(
  e: KeyboardEvent<HTMLInputElement>,
  onValueChange: (value: string) => void,
): void {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.key.toLowerCase() !== "j") return;

  e.preventDefault();
  const input = e.currentTarget;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const next = input.value.slice(0, start) + JUNCTION_SUFFIX + input.value.slice(end);
  const caret = start + JUNCTION_SUFFIX.length;

  onValueChange(next);
  // The value comes back from React state, so the caret has to be re-applied after the re-render.
  requestAnimationFrame(() => {
    input.setSelectionRange(caret, caret);
  });
}
