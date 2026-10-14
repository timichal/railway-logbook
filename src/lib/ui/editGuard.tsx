"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useToast } from "@/lib/toast";

/**
 * Unsaved edits in My Trips / My Journeys, held above the cards that make them.
 *
 * An edit (from Edit until Save or Cancel) is a draft kept here under the key of
 * what it edits, not state inside the card. Plenty closes or unmounts a card
 * without its say: another card opening (single-open), its trip collapsing or
 * being deleted, another sidebar tab, a region switch, a search or reload that
 * leaves it off the page, the desktop/mobile layout swap. Each of those now only
 * puts the edit away; the card picks its draft up when it is opened again, and
 * says it has one while closed. A draft nobody typed into is dropped as its card
 * closes, so a card isn't found in edit mode with no sign of why.
 *
 * A draft is lost only with the page or the account: reloading or leaving the
 * page, or signing in or out (drafts are made against one account's journeys, so
 * they are dropped when `owner` changes). Those are what ask first —
 * `confirmDiscard` where the page can ask, `beforeunload` where only the browser
 * can. A draft whose journey turns out to be gone is dropped by its card.
 *
 * The drafts are an external store read per key (`useSyncExternalStore`) rather
 * than a context value: a keystroke in one form re-renders that form, not every
 * card in the list.
 */
interface DraftEntry {
  value: unknown;
  /** How the question names it, quotes included ("Summer trip", the new trip). */
  label: string;
  /** Whether Save would change anything; an edit nobody typed into isn't asked about. */
  changed: boolean;
}

interface DraftStore {
  /** The same object until the key is written again, as `useSyncExternalStore` needs. */
  get: (key: string) => DraftEntry | undefined;
  set: (key: string, entry: DraftEntry | null) => void;
  /** Drops every draft whose key `drop` picks. */
  prune: (drop: (key: string) => boolean) => void;
  changedLabels: () => string[];
  subscribe: (listener: () => void) => () => void;
}

function createDraftStore(): DraftStore {
  const drafts = new Map<string, DraftEntry>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    get: (key) => drafts.get(key),
    set: (key, entry) => {
      if (entry === null) {
        if (!drafts.delete(key)) return;
      } else {
        drafts.set(key, entry);
      }
      emit();
    },
    prune: (drop) => {
      const keys = [...drafts.keys()].filter(drop);
      for (const key of keys) drafts.delete(key);
      if (keys.length > 0) emit();
    },
    changedLabels: () =>
      [...drafts.values()].filter((entry) => entry.changed).map((entry) => entry.label),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

interface EditGuard {
  store: DraftStore;
  /** Runs `action` at once, or once the user agrees to lose every changed draft. */
  confirmDiscard: (action: () => void) => void;
}

const EditGuardContext = createContext<EditGuard | null>(null);

/** One key space for every form, so a trip can ask after its journeys' drafts. */
export const tripEditKey = (id: number) => `trip-${id}`;
export const journeyEditKey = (id: number | string) => `journey-${id}`;
export const NEW_TRIP_EDIT_KEY = "new-trip";

export function EditGuardProvider({
  owner,
  children,
}: {
  /** Whose journeys the drafts edit; a change (sign in or out) drops them all. */
  owner: number | null;
  children: ReactNode;
}) {
  const { showConfirm } = useToast();
  const [held, setHeld] = useState(() => ({ owner, store: createDraftStore() }));
  if (held.owner !== owner) setHeld({ owner, store: createDraftStore() });
  const { store } = held;

  const guard = useMemo<EditGuard>(
    () => ({
      store,
      confirmDiscard: (action) => {
        const names = store.changedLabels();
        if (names.length === 0) {
          action();
          return;
        }
        showConfirm({
          title: "Discard changes?",
          message: `Your changes to ${names.join(" and ")} haven't been saved.`,
          confirmLabel: "Discard",
          cancelLabel: "Keep editing",
          variant: "danger",
          onConfirm: action,
        });
      },
    }),
    [store, showConfirm],
  );

  // Reloading, closing the tab or leaving the app is past asking in our own
  // dialog; the browser asks instead, in its own words. `returnValue` too, for the
  // older Chromium and WebKit that ask only when it is set to something truthy.
  const hasChanges = useSyncExternalStore(
    store.subscribe,
    () => store.changedLabels().length > 0,
    () => false,
  );
  useEffect(() => {
    if (!hasChanges) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasChanges]);

  return <EditGuardContext.Provider value={guard}>{children}</EditGuardContext.Provider>;
}

function useDraftStore(): DraftStore {
  const guard = useContext(EditGuardContext);
  if (!guard) throw new Error("Drafts need an EditGuardProvider");
  return guard.store;
}

/**
 * For a form: its draft under `key` (null while it isn't being edited), whether
 * that draft has changes, and the setter — null ends the edit. `isChanged` is read
 * on every write, and `label` names the draft in the question.
 */
export function useDraft<T>(key: string, label: string, isChanged: (draft: T) => boolean) {
  const store = useDraftStore();
  const entry = useSyncExternalStore(
    store.subscribe,
    () => store.get(key),
    () => undefined,
  );
  const setDraft = (next: T | null) =>
    store.set(key, next === null ? null : { value: next, label, changed: isChanged(next) });
  return {
    draft: entry === undefined ? null : (entry.value as T),
    changed: entry?.changed ?? false,
    setDraft,
  };
}

/** Whether any of `keys` has a draft with changes. */
export function useHasChanges(keys: readonly string[]): boolean {
  const store = useDraftStore();
  return useSyncExternalStore(
    store.subscribe,
    () => keys.some((key) => store.get(key)?.changed),
    () => false,
  );
}

/**
 * Drops the journey drafts whose journey is not among `ids`. Only for a list that
 * holds every journey there is (localStorage); a paged list can't tell a journey
 * on another page from a deleted one.
 */
export function usePruneJourneyDrafts(): (ids: Iterable<number | string>) => void {
  const store = useDraftStore();
  return useCallback(
    (ids) => {
      const live = new Set([...ids].map(journeyEditKey));
      store.prune((key) => key.startsWith(journeyEditKey("")) && !live.has(key));
    },
    [store],
  );
}

/**
 * The guard's `confirmDiscard`; outside a provider (the admin page, a shared map)
 * the action runs at once.
 */
export function useConfirmDiscard(): EditGuard["confirmDiscard"] {
  const guard = useContext(EditGuardContext);
  return useCallback(
    (action: () => void) => (guard ? guard.confirmDiscard(action) : action()),
    [guard],
  );
}

/**
 * A link's `onClick` that asks before leaving the page by a client-side
 * navigation, which `beforeunload` never sees. A click that opens a new tab or
 * window leaves this one as it is, so it goes through unasked.
 */
export function useGuardedLinkClick(href: string) {
  const router = useRouter();
  const confirmDiscard = useConfirmDiscard();
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    confirmDiscard(() => router.push(href));
  };
}
