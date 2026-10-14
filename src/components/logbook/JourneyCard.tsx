"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CardActions from "@/components/logbook/CardActions";
import CardHeader from "@/components/logbook/CardHeader";
import JourneyMetaFields from "@/components/logbook/JourneyMetaFields";
import LoggedRouteRow from "@/components/logbook/LoggedRouteRow";
import { useBottomSheet } from "@/components/ui/MobileBottomSheet";
import { ActionError, actionErrorMessage } from "@/lib/actionResult";
import type { JourneyStore } from "@/lib/journeyStore";
import { plural } from "@/lib/plural";
import { useRegionId } from "@/lib/regionContext";
import { formatDateOnly } from "@/lib/shared/getUntimezonedDateStr";
import { routeTitle } from "@/lib/shared/map/routeFeature";
import type {
  HighlightRoutesFn,
  JourneyEditStartFn,
  RailwayRoute,
  SelectedRoute,
} from "@/lib/shared/types";
import { useToast } from "@/lib/toast";
import type { TripWithStats } from "@/lib/tripActions";
import { btn } from "@/lib/ui/buttonStyles";
import { journeyEditKey, useDraft } from "@/lib/ui/editGuard";
import { useFocusAfterRender } from "@/lib/ui/useFocusAfterRender";

function buildRouteFromSelected(route: SelectedRoute): RailwayRoute {
  return {
    track_id: route.track_id,
    name: route.name,
    from_station: route.from_station,
    to_station: route.to_station,
    description: route.description,
    usage_type: 0 as RailwayRoute["usage_type"],
    frequency: [],
    link: route.link ?? null,
    geometry: "",
    length_km: route.length_km,
    partial: false,
  };
}

/** What the list knows of a journey before it is opened. */
interface JourneySummary<Id> {
  id: Id;
  name: string;
  description: string | null;
  date: string;
  trip_id?: number | null;
  route_count: number;
  /** Left out where the list doesn't know it (the local journeys). */
  total_distance?: number;
}

interface JourneyCardProps<Id> {
  journey: JourneySummary<Id>;
  store: JourneyStore<Id>;
  /**
   * The trips it can be filed under; left out, it has no trip field. Null while
   * they load, so a trip missing from the list can be told from one not yet in it.
   */
  availableTrips?: TripWithStats[] | null;
  // Tells parent whether this card is the currently-open one. Parent enforces single-open.
  isOpen: boolean;
  onRequestOpen: () => void;
  onRequestClose: () => void;
  // Mutation lifecycle
  onChanged: () => void; // After save/delete/route changes — refresh the list and map
  // Map interaction
  onHighlightRoutes?: HighlightRoutesFn;
  onJourneyEditStart?: JourneyEditStartFn;
  onJourneyEditEnd?: () => void;
  // Visual nesting (when rendered inside a trip card)
  nested?: boolean;
}

interface JourneySnapshot {
  routes: RailwayRoute[];
  name: string;
  date: string;
  description: string;
  tripId: number | null;
}

/**
 * An edit in progress: the journey as it was when Edit was pressed, which Save
 * diffs against, and the form as it stands. Kept by the edit guard rather than
 * the card, so it outlives the card closing or unmounting.
 */
interface JourneyDraft {
  base: JourneySnapshot;
  edit: JourneySnapshot;
}

/** The routes Save sends: added or re-ticked, and removed. */
function routeChanges(original: RailwayRoute[], edited: RailwayRoute[]) {
  const origMap = new Map(original.map((r) => [r.track_id, r]));
  const editedIds = new Set(edited.map((r) => r.track_id));
  const upsert = edited.flatMap((route) => {
    const orig = origMap.get(route.track_id);
    const partial = route.partial ?? false;
    return !orig || (orig.partial ?? false) !== partial
      ? [{ trackId: route.track_id, partial }]
      : [];
  });
  const remove = original
    .filter((orig) => !editedIds.has(orig.track_id))
    .map((orig) => orig.track_id);
  return { upsert, remove };
}

/**
 * Whether Save would change anything — what the edit guard asks about. The name
 * and description as Save sends them, trimmed.
 */
function differsFrom({ base, edit }: JourneyDraft): boolean {
  if (
    edit.name.trim() !== base.name.trim() ||
    edit.date !== base.date ||
    edit.description.trim() !== base.description.trim() ||
    edit.tripId !== base.tripId
  ) {
    return true;
  }
  const { upsert, remove } = routeChanges(base.routes, edit.routes);
  return upsert.length > 0 || remove.length > 0;
}

/**
 * A resumed draft moved onto the journey as just loaded, which may have changed
 * since Edit was pressed (on another device, or through another card here). A
 * field the draft left alone takes the loaded value; of the routes, the draft's
 * additions, removals and re-ticks are replayed onto the loaded list, so Save
 * sends exactly what the form shows.
 */
function rebase({ base, edit }: JourneyDraft, loaded: JourneySnapshot): JourneyDraft {
  const field = <K extends "name" | "date" | "description" | "tripId">(key: K) =>
    edit[key] === base[key] ? loaded[key] : edit[key];
  const before = new Map(base.routes.map((r) => [r.track_id, r]));
  const after = new Map(edit.routes.map((r) => [r.track_id, r]));
  const loadedIds = new Set(loaded.routes.map((r) => r.track_id));
  const routes = [
    ...loaded.routes.flatMap((route) => {
      const was = before.get(route.track_id);
      const is = after.get(route.track_id);
      // Removed in the draft; or untouched by it, added elsewhere or not
      if (!is) return was ? [] : [route];
      const reticked = !was || (was.partial ?? false) !== (is.partial ?? false);
      return [reticked ? { ...route, partial: is.partial } : route];
    }),
    // Added in the draft. One the draft kept but that is gone from the loaded
    // journey was removed elsewhere, and stays removed.
    ...edit.routes.filter((r) => !before.has(r.track_id) && !loadedIds.has(r.track_id)),
  ];
  return {
    base: loaded,
    edit: {
      routes,
      name: field("name"),
      date: field("date"),
      description: field("description"),
      tripId: field("tripId"),
    },
  };
}

export default function JourneyCard<Id extends number | string>({
  journey,
  store,
  availableTrips,
  isOpen,
  onRequestOpen,
  onRequestClose,
  onChanged,
  onHighlightRoutes,
  onJourneyEditStart,
  onJourneyEditEnd,
  nested = false,
}: JourneyCardProps<Id>) {
  const { showSuccess, showError } = useToast();
  const regionId = useRegionId();
  const sheet = useBottomSheet();

  // The journey as last loaded or saved: what the view shows and Edit starts from
  const [originalSnapshot, setOriginalSnapshot] = useState<JourneySnapshot | null>(null);
  // An open card shows the journey; only Edit lets map taps change it. A draft
  // left by a card that closed mid-edit is taken up again when it reopens.
  const { draft, changed, setDraft } = useDraft<JourneyDraft>(
    journeyEditKey(journey.id),
    `"${journey.name}"`,
    differsFrom,
  );
  const [isSaving, setIsSaving] = useState(false);
  // Until the journey has loaded there is nothing to view or edit, and the snapshot
  // is what says it has — so the card reads as loading from its first render, not
  // only once the load effect has run.
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const isLoading = originalSnapshot === null && !loadFailed;

  // Not before the journey has loaded: a resumed draft is rebased on it first, and
  // until then the card shows no form to go with map taps that change it
  const editing = isOpen && draft !== null && originalSnapshot !== null;
  const viewedRoutes = (editing ? draft.edit.routes : originalSnapshot?.routes) ?? [];
  const updateEdit = (patch: Partial<JourneySnapshot>) => {
    if (draft) setDraft({ ...draft, edit: { ...draft.edit, ...patch } });
  };

  const focusAfterRender = useFocusAfterRender();
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const editHeadingRef = useRef<HTMLHeadingElement>(null);

  // Mutable handler ref so the stable map click callback, and whatever finishes
  // after an await or runs as the card closes, always sees fresh state
  const editStateRef = useRef({
    editing,
    viewedRoutes,
    updateEdit,
    isOpen,
    draft,
    changed,
    setDraft,
  });
  editStateRef.current = { editing, viewedRoutes, updateEdit, isOpen, draft, changed, setDraft };

  const handleMapRouteClickRef = useRef<((route: SelectedRoute) => void) | undefined>(undefined);
  handleMapRouteClickRef.current = (route: SelectedRoute) => {
    const { editing, viewedRoutes, updateEdit } = editStateRef.current;
    if (!editing) return;

    const routeId = route.track_id;
    const isInJourney = viewedRoutes.some((r) => r.track_id === routeId);
    const newRoutes = isInJourney
      ? viewedRoutes.filter((r) => r.track_id !== routeId)
      : [...viewedRoutes, buildRouteFromSelected(route)];

    updateEdit({ routes: newRoutes });
    onHighlightRoutes?.(newRoutes.map((r) => r.track_id));
  };

  const stableHandleMapRouteClick = useCallback((route: SelectedRoute) => {
    handleMapRouteClickRef.current?.(route);
  }, []);

  // Read through the ref for the same reason the handler above is: the map keeps
  // whatever it was handed for the whole edit session.
  const stableIsRouteInJourney = useCallback(
    (trackId: number) => editStateRef.current.viewedRoutes.some((r) => r.track_id === trackId),
    [],
  );

  // Load journey details when this card opens. A draft being resumed is rebased on
  // what loaded and is what the map shows; read through the ref so that editing it
  // doesn't reload. A journey that turns out to be gone takes its draft with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onHighlightRoutes and regionId are intentionally omitted; the effect should fire only when the card opens, the journey changes or a retry is asked for, not when the callback identity changes, and the region only scopes the fit that opening does.
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setLoadFailed(false);
    (async () => {
      try {
        const result = await store.load(journey.id, regionId);
        if (cancelled) return;
        const loaded: JourneySnapshot = {
          routes: result.routes,
          name: result.journey.name,
          date: result.journey.date,
          description: result.journey.description || "",
          tripId: result.journey.trip_id ?? null,
        };
        const { draft, setDraft } = editStateRef.current;
        const resumed = draft && rebase(draft, loaded);
        if (resumed) setDraft(resumed);
        setOriginalSnapshot(loaded);
        onHighlightRoutes?.(
          (resumed?.edit ?? loaded).routes.map((r) => r.track_id),
          "view",
          undefined,
          {
            fit: true,
            bounds: result.bounds,
          },
        );
      } catch (error) {
        if (cancelled) return;
        console.error("Error loading journey:", error);
        showError(actionErrorMessage(error, "Failed to load journey"));
        if (error instanceof ActionError && error.notFound) editStateRef.current.setDraft(null);
        setLoadFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, journey.id, store, loadAttempt]);

  // The map edit session lasts exactly as long as an open card has a draft. The
  // cleanup also covers an unmount mid-edit: a card that leaves the list while
  // being edited (a search, a region switch) would otherwise leave map taps
  // toggling routes on an invisible journey.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onJourneyEditStart and onJourneyEditEnd are intentionally omitted; a new callback identity must not end and restart the session.
  useEffect(() => {
    if (!editing) return;
    onJourneyEditStart?.(stableHandleMapRouteClick, stableIsRouteInJourney);
    return () => onJourneyEditEnd?.();
  }, [editing, stableHandleMapRouteClick, stableIsRouteInJourney]);

  // When this card closes, reset its state — all but a draft with changes, which
  // waits for it to reopen. The map edit session itself is ended by the effect above.
  useEffect(() => {
    if (isOpen) return;
    setOriginalSnapshot(null);
    setLoadFailed(false);
    // Don't clear highlights here — parent owns coordination across cards
  }, [isOpen]);

  // A draft nobody typed into goes as the card closes or unmounts, or the card
  // would reopen in edit mode with no Unsaved to say why
  useEffect(() => {
    if (!isOpen) return;
    return () => {
      const { draft, changed, setDraft } = editStateRef.current;
      if (draft && !changed) setDraft(null);
    };
  }, [isOpen]);

  // A trip the draft files the journey under, deleted since (here or elsewhere),
  // can't be saved to: the draft falls back to the journey's own trip, or none.
  // biome-ignore lint/correctness/useExhaustiveDependencies: updateEdit is a fresh closure over the same draft each render.
  useEffect(() => {
    if (!draft || !availableTrips) return;
    const exists = (id: number | null) => id === null || availableTrips.some((t) => t.id === id);
    if (exists(draft.edit.tripId)) return;
    updateEdit({ tripId: exists(draft.base.tripId) ? draft.base.tripId : null });
  }, [draft, availableTrips]);

  const handleStartEdit = () => {
    if (!originalSnapshot) return;
    setDraft({ base: originalSnapshot, edit: originalSnapshot });
    // Editing is picking routes on the map, which the sheet's top snap leaves as
    // a sliver. Null on desktop.
    sheet?.snapTo("half");
    // The form's heading rather than its first field, which on a phone would
    // raise the keyboard over the map the routes are picked on
    focusAfterRender(() => editHeadingRef.current);
  };

  const handleCancelEdit = () => {
    setDraft(null);
    focusAfterRender(() => editButtonRef.current);
    if (originalSnapshot) onHighlightRoutes?.(originalSnapshot.routes.map((r) => r.track_id));
  };

  const handleTogglePartial = (trackId: number, nextPartial: boolean) => {
    updateEdit({
      routes: viewedRoutes.map((r) =>
        r.track_id === trackId ? { ...r, partial: nextPartial } : r,
      ),
    });
  };

  const handleRemoveRoute = (trackId: number) => {
    const newRoutes = viewedRoutes.filter((r) => r.track_id !== trackId);
    updateEdit({ routes: newRoutes });
    onHighlightRoutes?.(newRoutes.map((r) => r.track_id));
  };

  const handleSave = async () => {
    if (!draft) return;
    const { base, edit } = draft;
    const trimmedName = edit.name.trim();
    const trimmedDescription = edit.description.trim();

    if (!trimmedName || !edit.date) {
      showError("Journey name and date are required");
      return;
    }

    // Only the difference goes to the store, which applies all of it or none: a
    // failed save changes nothing, so the base still matches the journey and
    // pressing Save again retries the whole edit
    const { upsert, remove } = routeChanges(base.routes, edit.routes);
    const tripChanged = edit.tripId !== base.tripId;

    setIsSaving(true);
    try {
      await store.save(journey.id, {
        name: trimmedName,
        description: trimmedDescription || null,
        date: edit.date,
        tripId: tripChanged ? edit.tripId : undefined,
        upsert,
        remove,
      });

      showSuccess("Journey updated");
      setDraft(null);
      // Only if it is still the open card: the header can close it, and another
      // card open, while the save is on its way
      if (editStateRef.current.isOpen) {
        if (tripChanged) {
          // It is listed somewhere else now, so this card is on its way out
          onRequestClose();
        } else {
          // Back to the view, which now shows what was just saved
          setOriginalSnapshot({ ...edit, name: trimmedName, description: trimmedDescription });
          focusAfterRender(() => editButtonRef.current);
        }
      }
      onChanged();
    } catch (error) {
      console.error("Error saving journey:", error);
      showError(actionErrorMessage(error, "Failed to save journey"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await store.remove(journey.id);
      showSuccess("Journey deleted");
      onRequestClose();
      onChanged();
      return true;
    } catch (error) {
      console.error("Error deleting journey:", error);
      showError(actionErrorMessage(error, "Failed to delete journey"));
      return false;
    }
  };

  // One list for both modes: editing adds the partial toggle and the remove button,
  // the view shows the same rows read-only.
  const routeList = (
    <div className="space-y-1 max-h-64 overflow-y-auto">
      {viewedRoutes.map((route) => {
        // A naming region leads with the line name, endpoints beneath
        const { name, endpoints } = routeTitle(route, regionId);
        return (
          <LoggedRouteRow
            key={route.track_id}
            title={name ?? endpoints}
            subtitle={name ? endpoints : undefined}
            lengthKm={route.length_km}
            partial={route.partial ?? false}
            covered={{ start: route.covered_start, end: route.covered_end }}
            {...(editing && {
              onPartialChange: (partial: boolean) => handleTogglePartial(route.track_id, partial),
              onRemove: () => handleRemoveRoute(route.track_id),
            })}
          />
        );
      })}
    </div>
  );

  return (
    <div
      className={`border rounded shadow-sm ${nested ? "bg-gray-50 border-gray-200" : "bg-surface border-gray-300"}`}
    >
      <CardHeader
        title={journey.name}
        description={journey.description}
        meta={[
          formatDateOnly(journey.date),
          plural(journey.route_count, "route"),
          journey.total_distance !== undefined && `${journey.total_distance.toFixed(1)} km`,
        ]
          .filter(Boolean)
          .join(" · ")}
        isOpen={isOpen}
        onToggle={isOpen ? onRequestClose : onRequestOpen}
        unsaved={changed}
      />

      {isOpen && (
        <div className="px-3 pb-3 pt-2 border-t border-gray-200 space-y-3">
          {loadFailed ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 text-xs text-gray-600">Couldn't load this journey.</span>
              <button
                type="button"
                onClick={() => setLoadAttempt((n) => n + 1)}
                className={`${btn("subtle", "xs")} flex-shrink-0`}
              >
                Retry
              </button>
            </div>
          ) : isLoading ? (
            <div className="text-xs text-gray-500 text-center py-2">Loading…</div>
          ) : editing ? (
            <>
              <div className="px-2 py-1.5 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
                Click routes on the map to add or remove them from this journey
              </div>

              <div>
                <h5
                  ref={editHeadingRef}
                  tabIndex={-1}
                  className="text-sm font-semibold text-gray-700 mb-2 focus:outline-none"
                >
                  Edit Journey
                </h5>
                <JourneyMetaFields
                  idPrefix={`journey-${journey.id}`}
                  compact
                  name={draft.edit.name}
                  onNameChange={(name) => updateEdit({ name })}
                  date={draft.edit.date}
                  onDateChange={(date) => updateEdit({ date })}
                  description={draft.edit.description}
                  onDescriptionChange={(description) => updateEdit({ description })}
                  trip={
                    availableTrips === undefined
                      ? undefined
                      : {
                          value: draft.edit.tripId,
                          options: availableTrips ?? [],
                          onChange: (tripId) => updateEdit({ tripId }),
                        }
                  }
                />
              </div>

              <div>
                <h5 className="text-sm font-semibold text-gray-700 mb-2">
                  Routes in this journey:
                </h5>
                {viewedRoutes.length === 0 ? (
                  <p className="text-xs text-gray-500 italic">
                    No routes — click routes on the map to add them.
                  </p>
                ) : (
                  routeList
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className={`${btn("success")} flex-1`}
                >
                  {isSaving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                  className={`${btn("subtle")} flex-1`}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              {viewedRoutes.length === 0 ? (
                <p className="text-xs text-gray-500 italic">No routes in this journey.</p>
              ) : (
                routeList
              )}

              <CardActions
                editLabel="Edit"
                editVariant="primary"
                editButtonRef={editButtonRef}
                onEdit={handleStartEdit}
                deleteLabel="Delete"
                question="Delete this journey?"
                onDelete={handleDelete}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
