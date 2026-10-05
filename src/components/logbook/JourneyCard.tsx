"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CardHeader, { countOf } from "@/components/logbook/CardHeader";
import JourneyMetaFields from "@/components/logbook/JourneyMetaFields";
import LoggedRouteRow from "@/components/logbook/LoggedRouteRow";
import { useBottomSheet } from "@/components/ui/MobileBottomSheet";
import { actionErrorMessage, unwrap } from "@/lib/actionResult";
import { deleteJourney, getJourney, saveJourneyEdits } from "@/lib/journeyActions";
import { useRegionId } from "@/lib/regionContext";
import { formatDateOnly } from "@/lib/shared/getUntimezonedDateStr";
import type {
  HighlightRoutesFn,
  Journey,
  JourneyEditStartFn,
  RailwayRoute,
  SelectedRoute,
} from "@/lib/shared/types";
import { useToast } from "@/lib/toast";
import type { TripWithStats } from "@/lib/tripActions";
import { btn } from "@/lib/ui/buttonStyles";

function buildRouteFromSelected(route: SelectedRoute): RailwayRoute {
  return {
    track_id: route.track_id,
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

interface JourneyDisplay extends Journey {
  route_count: number;
  total_distance: string;
}

interface JourneyCardProps {
  journey: JourneyDisplay;
  availableTrips: TripWithStats[];
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

export default function JourneyCard({
  journey,
  availableTrips,
  isOpen,
  onRequestOpen,
  onRequestClose,
  onChanged,
  onHighlightRoutes,
  onJourneyEditStart,
  onJourneyEditEnd,
  nested = false,
}: JourneyCardProps) {
  const { showSuccess, showError } = useToast();
  const regionId = useRegionId();
  const sheet = useBottomSheet();

  const [viewedRoutes, setViewedRoutes] = useState<RailwayRoute[]>([]);
  const [editName, setEditName] = useState(journey.name);
  const [editDate, setEditDate] = useState(journey.date);
  const [editDescription, setEditDescription] = useState(journey.description || "");
  const [editTripId, setEditTripId] = useState<number | null>(journey.trip_id);
  // The journey as last loaded or saved: what Cancel goes back to and what Save
  // diffs against.
  const [originalSnapshot, setOriginalSnapshot] = useState<JourneySnapshot | null>(null);
  // An open card shows the journey; only Edit lets map taps change it.
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const editing = isOpen && isEditing;

  // Mutable handler ref so the stable map click callback always sees fresh state
  const editStateRef = useRef({ editing, viewedRoutes });
  editStateRef.current = { editing, viewedRoutes };

  const handleMapRouteClickRef = useRef<((route: SelectedRoute) => void) | undefined>(undefined);
  handleMapRouteClickRef.current = (route: SelectedRoute) => {
    const { editing, viewedRoutes } = editStateRef.current;
    if (!editing) return;

    const routeId = route.track_id;
    const isInJourney = viewedRoutes.some((r) => r.track_id === routeId);
    const newRoutes = isInJourney
      ? viewedRoutes.filter((r) => r.track_id !== routeId)
      : [...viewedRoutes, buildRouteFromSelected(route)];

    setViewedRoutes(newRoutes);
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

  const applySnapshot = useCallback((snapshot: JourneySnapshot) => {
    setViewedRoutes(snapshot.routes);
    setEditName(snapshot.name);
    setEditDate(snapshot.date);
    setEditDescription(snapshot.description);
    setEditTripId(snapshot.tripId);
    setOriginalSnapshot(snapshot);
  }, []);

  // Load journey details when this card opens
  // biome-ignore lint/correctness/useExhaustiveDependencies: onHighlightRoutes and regionId are intentionally omitted; the effect should fire only when the card opens or the journey changes, not when the callback identity changes, and the region only scopes the fit that opening does.
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setIsLoadingDetails(true);
    (async () => {
      try {
        const result = unwrap(await getJourney(journey.id, regionId));
        if (cancelled) return;
        const routes = result.routes;
        if (result.journey) {
          applySnapshot({
            routes,
            name: result.journey.name,
            date: result.journey.date,
            description: result.journey.description || "",
            tripId: result.journey.trip_id,
          });
        } else {
          setViewedRoutes(routes);
        }
        onHighlightRoutes?.(
          routes.map((r) => r.track_id),
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
      } finally {
        if (!cancelled) setIsLoadingDetails(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, journey.id]);

  // The map edit session lasts exactly as long as edit mode. The cleanup also
  // covers an unmount mid-edit: a card that leaves the list while being edited
  // (a search with no hits, a region switch) would otherwise leave map taps
  // toggling routes on an invisible journey.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onJourneyEditStart and onJourneyEditEnd are intentionally omitted; a new callback identity must not end and restart the session.
  useEffect(() => {
    if (!editing) return;
    onJourneyEditStart?.(stableHandleMapRouteClick, stableIsRouteInJourney);
    return () => onJourneyEditEnd?.();
  }, [editing, stableHandleMapRouteClick, stableIsRouteInJourney]);

  // When this card closes, reset its state. The map edit session itself is ended
  // by the effect above.
  useEffect(() => {
    if (isOpen) return;
    setIsEditing(false);
    setViewedRoutes([]);
    setOriginalSnapshot(null);
    setDeleteConfirm(false);
    // Don't clear highlights here — parent owns coordination across cards
  }, [isOpen]);

  const handleStartEdit = () => {
    setDeleteConfirm(false);
    setIsEditing(true);
    // Editing is picking routes on the map, which the sheet's top snap leaves as
    // a sliver. Null on desktop.
    sheet?.snapTo("half");
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    if (!originalSnapshot) return;
    applySnapshot(originalSnapshot);
    onHighlightRoutes?.(originalSnapshot.routes.map((r) => r.track_id));
  };

  const handleTogglePartial = (trackId: number, nextPartial: boolean) => {
    setViewedRoutes((prev) =>
      prev.map((r) => (r.track_id === trackId ? { ...r, partial: nextPartial } : r)),
    );
  };

  const handleRemoveRoute = (trackId: number) => {
    const newRoutes = viewedRoutes.filter((r) => r.track_id !== trackId);
    setViewedRoutes(newRoutes);
    onHighlightRoutes?.(newRoutes.map((r) => r.track_id));
  };

  const handleSave = async () => {
    if (!originalSnapshot) return;
    const trimmedName = editName.trim();
    const trimmedDescription = editDescription.trim();

    if (!trimmedName || !editDate) {
      showError("Journey name and date are required");
      return;
    }

    // Only the difference goes to the server, applied there in one transaction:
    // a failed save changes nothing, so the snapshot still matches the journey
    // and pressing Save again retries the whole edit
    const origMap = new Map(originalSnapshot.routes.map((r) => [r.track_id, r]));
    const editedIds = new Set(viewedRoutes.map((r) => r.track_id));
    const upsert = viewedRoutes.flatMap((edited) => {
      const orig = origMap.get(edited.track_id);
      const partial = edited.partial ?? false;
      return !orig || (orig.partial ?? false) !== partial
        ? [{ trackId: edited.track_id, partial }]
        : [];
    });
    const remove = originalSnapshot.routes
      .filter((orig) => !editedIds.has(orig.track_id))
      .map((orig) => orig.track_id);
    const tripChanged = editTripId !== originalSnapshot.tripId;

    setIsSaving(true);
    try {
      unwrap(
        await saveJourneyEdits(journey.id, {
          name: trimmedName,
          description: trimmedDescription || null,
          date: editDate,
          tripId: tripChanged ? editTripId : undefined,
          upsert,
          remove,
        }),
      );

      showSuccess("Journey updated");
      if (tripChanged) {
        // It is listed somewhere else now, so this card is on its way out
        onRequestClose();
      } else {
        // Back to the view, which now shows what was just saved
        applySnapshot({
          routes: viewedRoutes,
          name: trimmedName,
          date: editDate,
          description: trimmedDescription,
          tripId: editTripId,
        });
        setIsEditing(false);
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
      unwrap(await deleteJourney(journey.id));
      showSuccess("Journey deleted");
      onRequestClose();
      onChanged();
    } catch (error) {
      console.error("Error deleting journey:", error);
      showError(actionErrorMessage(error, "Failed to delete journey"));
    } finally {
      setDeleteConfirm(false);
    }
  };

  return (
    <div
      className={`border rounded shadow-sm ${nested ? "bg-gray-50 border-gray-200" : "bg-surface border-gray-300"}`}
    >
      <CardHeader
        title={journey.name}
        description={journey.description}
        meta={[
          formatDateOnly(journey.date),
          countOf(journey.route_count, "route"),
          `${Number(journey.total_distance).toFixed(1)} km`,
        ].join(" · ")}
        isOpen={isOpen}
        onToggle={isOpen ? onRequestClose : onRequestOpen}
        locked={editing}
      />

      {isOpen && (
        <div className="px-3 pb-3 pt-2 border-t border-gray-200 space-y-3">
          {isLoadingDetails ? (
            <div className="text-xs text-gray-500 text-center py-2">Loading…</div>
          ) : editing ? (
            <>
              <div className="px-2 py-1.5 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
                Click routes on the map to add or remove them from this journey
              </div>

              <div>
                <h5 className="text-sm font-semibold text-gray-700 mb-2">Edit Journey</h5>
                <JourneyMetaFields
                  idPrefix={`journey-${journey.id}`}
                  compact
                  name={editName}
                  onNameChange={setEditName}
                  date={editDate}
                  onDateChange={setEditDate}
                  description={editDescription}
                  onDescriptionChange={setEditDescription}
                  trip={{ value: editTripId, options: availableTrips, onChange: setEditTripId }}
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
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {viewedRoutes.map((route) => (
                      <LoggedRouteRow
                        key={route.track_id}
                        title={`${route.from_station} ⟷ ${route.to_station}`}
                        lengthKm={route.length_km}
                        partial={route.partial ?? false}
                        onPartialChange={(partial) => handleTogglePartial(route.track_id, partial)}
                        onRemove={() => handleRemoveRoute(route.track_id)}
                      />
                    ))}
                  </div>
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
                <ul className="space-y-1 max-h-64 overflow-y-auto">
                  {viewedRoutes.map((route) => (
                    <li
                      key={route.track_id}
                      className="flex items-baseline justify-between gap-2 text-xs"
                    >
                      <span className="min-w-0 truncate">
                        {route.from_station} ⟷ {route.to_station}
                      </span>
                      <span className="flex-shrink-0 text-gray-500">
                        {route.partial && <span className="text-orange-600">partial · </span>}
                        {Number(route.length_km).toFixed(1)} km
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {deleteConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm text-gray-700">Delete this journey?</span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className={`${btn("danger")} flex-shrink-0`}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(false)}
                    className={`${btn("subtle")} flex-shrink-0`}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <button type="button" onClick={handleStartEdit} className={btn("primary")}>
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(true)}
                    className={btn("softDanger")}
                  >
                    Delete
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
