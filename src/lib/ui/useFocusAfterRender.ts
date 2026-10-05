import { useCallback, useEffect, useRef } from "react";

/**
 * Moves focus once the next render has committed, for a control that swaps itself
 * out of the DOM — Edit replaced by the form it opens, Save by the view it returns
 * to. Left alone, focus falls to `<body>` and the next Tab starts from the top of
 * the page.
 *
 * Call the returned function from the handler with a getter for the element that
 * should have focus; the getter runs after the render, when that element exists.
 */
export function useFocusAfterRender(): (target: () => HTMLElement | null) => void {
  const pending = useRef<(() => HTMLElement | null) | null>(null);

  // Every commit, deliberately: the request is consumed by the first render after it
  useEffect(() => {
    const target = pending.current;
    if (!target) return;
    pending.current = null;
    target()?.focus({ preventScroll: true });
  });

  return useCallback((target) => {
    pending.current = target;
  }, []);
}
