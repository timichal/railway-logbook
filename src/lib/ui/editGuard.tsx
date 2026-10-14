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
  useRef,
  useState,
} from "react";
import { useToast } from "@/lib/toast";

/**
 * Keeps unsaved changes in My Trips / My Journeys from being thrown away by
 * something outside the form holding them. A card locks its own header while it
 * is edited, but plenty else closes or unmounts it: another card opening
 * (single-open), the parent trip collapsing, another sidebar tab, a region
 * switch, signing in or out, leaving the page. Those live all over the page, so
 * the guard is held at the top of it (`MainLayout`): forms report their unsaved
 * changes, and anything that would drop them asks first.
 *
 * It is applied at each thing that closes a form rather than where a form is
 * lost, because by then it is too late to ask — so a new way of leaving My Trips
 * needs its own `confirmDiscard`.
 */
interface EditGuardActions {
  reportEditing: (key: string, label: string | null) => void;
  /**
   * Runs `action` at once, or once the user agrees to discard the changes it
   * would drop: those under `keys`, or every form's when left out.
   */
  confirmDiscard: (action: () => void, keys?: readonly string[]) => void;
}

// Two contexts: the actions never change, so a form's report doesn't re-run (and
// re-report) every time something starts or stops being edited.
const EditGuardActionsContext = createContext<EditGuardActions | null>(null);
const EditingContext = createContext<ReadonlyMap<string, string>>(new Map());

/** One key space for every form, so a trip can name its nested journey's. */
export const tripEditKey = (id: number) => `trip-${id}`;
export const journeyEditKey = (id: number | string) => `journey-${id}`;
export const NEW_TRIP_EDIT_KEY = "new-trip";

export function EditGuardProvider({ children }: { children: ReactNode }) {
  const { showConfirm } = useToast();
  // Key → what is being edited, as the question names it ("Summer trip", "the new trip")
  const [editing, setEditing] = useState<ReadonlyMap<string, string>>(() => new Map());
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const actions = useMemo<EditGuardActions>(
    () => ({
      reportEditing: (key, label) =>
        setEditing((prev) => {
          if (prev.get(key) === (label ?? undefined)) return prev;
          const next = new Map(prev);
          if (label === null) next.delete(key);
          else next.set(key, label);
          return next;
        }),
      confirmDiscard: (action, keys) => {
        const current = editingRef.current;
        const names = (keys ?? [...current.keys()]).flatMap((key) => {
          const name = current.get(key);
          return name === undefined ? [] : [name];
        });
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
    [showConfirm],
  );

  // Reloading, closing the tab or leaving the app is past asking in our own
  // dialog; the browser asks instead, in its own words.
  const hasChanges = editing.size > 0;
  useEffect(() => {
    if (!hasChanges) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasChanges]);

  return (
    <EditGuardActionsContext.Provider value={actions}>
      <EditingContext.Provider value={editing}>{children}</EditingContext.Provider>
    </EditGuardActionsContext.Provider>
  );
}

/**
 * For a form: reports unsaved changes for as long as it has them, under `label`
 * (how the question names it, quotes included). Unmounting ends the report too.
 */
export function useReportEditing(key: string, label: string, hasChanges: boolean) {
  const guard = useContext(EditGuardActionsContext);
  useEffect(() => {
    if (!guard || !hasChanges) return;
    guard.reportEditing(key, label);
    return () => guard.reportEditing(key, null);
  }, [guard, key, label, hasChanges]);
}

/**
 * The guard's `confirmDiscard`; outside a provider (the admin page, a shared map)
 * the action runs at once.
 */
export function useConfirmDiscard(): EditGuardActions["confirmDiscard"] {
  const guard = useContext(EditGuardActionsContext);
  return useCallback(
    (action: () => void, keys?: readonly string[]) =>
      guard ? guard.confirmDiscard(action, keys) : action(),
    [guard],
  );
}

/** Whether any of `keys` has unsaved changes. */
export function useHasChanges(keys: readonly string[]): boolean {
  const editing = useContext(EditingContext);
  return keys.some((key) => editing.has(key));
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
