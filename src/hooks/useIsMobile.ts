import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Tracks a max-width media query.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the snapshot is read
 * during render, and React's own layout-effect check forces a synchronous re-render
 * when the hydration snapshot turns out to be wrong — so the corrected layout lands
 * in the *first paint* instead of a visible desktop-then-mobile flip. `useEffect`
 * runs after paint, which is what made every phone load flash the 600px sidebar,
 * close it, and resize the map.
 *
 * The server snapshot has to be something, and `false` (desktop) is the one that
 * matters least: the map subtree is `ssr: false`, so it mounts after the correction.
 */
export function useIsMobile(breakpoint = 768): boolean {
  const query = `(max-width: ${breakpoint - 1}px)`;

  const subscribe = useMemo(
    () => (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  const getServerSnapshot = () => false;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
