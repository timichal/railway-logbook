/**
 * A counter that goes up whenever the user's log changes.
 *
 * Logging a journey changes three things that are nowhere near each other: the
 * logbook list, the progress numbers over the map, and the **colour of the route on
 * the map**, which lives in a tile the server renders per user. Nothing in the React
 * tree connects them — the write happens in a modal, and the map is a tab the writer
 * cannot see — so the signal is a store rather than a context, and a reader subscribes
 * to it wherever it happens to be.
 *
 * `useSyncExternalStore` rather than a provider because there is no state to own here,
 * only a version: every reader re-reads from the server, and this says when.
 *
 * On the map it is spent as the tile URL's `cacheBuster` (`v=`), which is the same
 * mechanism the web app's route tile refresh (`useUserMap`) uses and the reason
 * `railwayRoutesTileUrl` takes one: a tile is cached by URL, so a *new* URL is the
 * only way to be sure the old colours are gone.
 *
 * The URL does not say whose colours a tile holds — the bearer header does — so a
 * sign-in bumps it (`AuthContext`): the next account must not meet the last one's
 * tiles in memory. It also starts at **the launch time rather than 0**, as a guard:
 * the handler sends `private, no-store`, but whether MapLibre Native's disk cache
 * honours that is unconfirmed (`MOBILE_AUDIT_TODO.md`), and a counter restarting at
 * 0 would ask for URLs an earlier launch, or another account, already fetched. If the
 * header turns out to be honoured, the clock is merely harmless.
 */
import { useSyncExternalStore } from "react";

let version = Date.now();
const listeners = new Set<() => void>();

/** Called by anything that writes a journey, a trip or a logged route, and by a new session. */
export function bumpLogVersion(): void {
  version = Math.max(version + 1, Date.now());
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number {
  return version;
}

export function useLogVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
