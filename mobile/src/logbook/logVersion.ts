/**
 * A counter that goes up whenever the user's log changes.
 *
 * Logging a journey changes four things that are nowhere near each other: the
 * logbook list, the progress numbers over the map, the ridden stretches, and the
 * **colour of the route on the map** (the rides, `useRides`). Nothing in the React
 * tree connects them — the write happens in a modal, and the map is a tab the writer
 * cannot see — so the signal is a store rather than a context, and a reader subscribes
 * to it wherever it happens to be.
 *
 * `useSyncExternalStore` rather than a provider because there is no state to own here,
 * only a version: every reader re-reads from the server, and this says when.
 *
 * A sign-in bumps it too (`AuthContext`), so everything is read again for the
 * account now signed in, and so does a return after a minute away, which is how a
 * ride logged on the web reaches the app. It starts at the launch time; only its
 * changes mean anything.
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
