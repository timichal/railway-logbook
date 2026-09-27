"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import JourneyMetaFields from "@/components/logbook/JourneyMetaFields";
import LoggedRouteRow from "@/components/logbook/LoggedRouteRow";
import { deleteJourney, getJourney, saveJourneyEdits } from "@/lib/journeyActions";
import { parseDateOnly } from "@/lib/shared/getUntimezonedDateStr";
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

  const [viewedRoutes, setViewedRoutes] = useState<RailwayRoute[]>([]);
  const [editName, setEditName] = useState(journey.name);
  const [editDate, setEditDate] = useState(journey.date);
  const [editDescription, setEditDescription] = useState(journey.description || "");
  const [editTripId, setEditTripId] = useState<number | null>(journey.trip_id);
  const [originalSnapshot, setOriginalSnapshot] = useState<{
    routes: RailwayRoute[];
    name: string;
    date: string;
    description: string;
    tripId: number | null;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  // Mutable handler ref so the stable map click callback always sees fresh state
  const editStateRef = useRef({ isOpen, viewedRoutes });
  editStateRef.current = { isOpen, viewedRoutes };

  const handleMapRouteClickRef = useRef<((route: SelectedRoute) => void) | undefined>(undefined);
  handleMapRouteClickRef.current = (route: SelectedRoute) => {
    const { isOpen, viewedRoutes } = editStateRef.current;
    if (!isOpen) return;

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

  // Load journey details when this card opens
  // biome-ignore lint/correctness/useExhaustiveDependencies: onHighlightRoutes, onJourneyEditStart and onJourneyEditEnd are intentionally omitted; the effect should fire only when the card opens or the journey changes, not when the callback identity changes.
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    let sessionStarted = false;
    setIsLoadingDetails(true);
    (async () => {
      try {
        const result = await getJourney(journey.id);
        if (cancelled) return;
        if (result.error) {
          showError(result.error);
          return;
        }
        const routes = result.routes || [];
        setViewedRoutes(routes);
        if (result.journey) {
          setEditName(result.journey.name);
          setEditDate(result.journey.date);
          setEditDescription(result.journey.description || "");
          setEditTripId(result.journey.trip_id);
          setOriginalSnapshot({
            routes,
            name: result.journey.name,
            date: result.journey.date,
            description: result.journey.description || "",
            tripId: result.journey.trip_id,
          });
        }
        onHighlightRoutes?.(routes.map((r) => r.track_id));
        onJourneyEditStart?.(stableHandleMapRouteClick, stableIsRouteInJourney);
        sessionStarted = true;
      } catch (error) {
        if (cancelled) return;
        console.error("Error loading journey:", error);
        showError("Failed to load journey");
      } finally {
        if (!cancelled) setIsLoadingDetails(false);
      }
    })();

    return () => {
      cancelled = true;
      // Covers the unmount the close effect below never sees: a card that
      // leaves the list while open (a search with no hits, a region switch)
      // would otherwise leave map clicks toggling routes on an invisible journey
      if (sessionStarted) onJourneyEditEnd?.();
    };
  }, [isOpen, journey.id]);

  // When this card closes, reset its edit state. The map edit session itself is
  // ended by the open effect's cleanup above, which also covers an unmount.
  useEffect(() => {
    if (isOpen) return;
    setViewedRoutes([]);
    setOriginalSnapshot(null);
    setDeleteConfirm(false);
    // Don't clear highlights here — parent owns coordination across cards
  }, [isOpen]);

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

    setIsSaving(true);
    try {
      const result = await saveJourneyEdits(journey.id, {
        name: trimmedName,
        description: trimmedDescription || null,
        date: editDate,
        tripId: editTripId !== originalSnapshot.tripId ? editTripId : undefined,
        upsert,
        remove,
      });
      if (result.error) {
        showError(result.error);
        return;
      }

      showSuccess("Journey updated");
      onRequestClose();
      onChanged();
    } catch (error) {
      console.error("Error saving journey:", error);
      showError("Failed to save journey");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      const result = await deleteJourney(journey.id);
      if (result.error) {
        showError(result.error);
      } else {
        showSuccess("Journey deleted");
        onRequestClose();
        onChanged();
      }
    } catch (error) {
      console.error("Error deleting journey:", error);
      showError("Failed to delete journey");
    } finally {
      setDeleteConfirm(false);
    }
  };

  return (
    <div
      className={`border rounded shadow-sm ${nested ? "bg-gray-50 border-gray-200" : "bg-surface border-gray-300"}`}
    >
      <div className="px-3 py-2 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 overflow-hidden">
            <span className="font-semibold text-sm truncate" title={journey.name}>
              {journey.name}
            </span>
            {journey.description && (
              <span className="text-xs text-gray-500 truncate" title={journey.description}>
                {journey.description}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-600 mt-0.5">
            {parseDateOnly(journey.date).toLocaleDateString()} · {journey.route_count} route
            {journey.route_count === 1 ? "" : "s"} · {Number(journey.total_distance).toFixed(1)} km
          </div>
        </div>
        {deleteConfirm ? (
          <>
            <button
              type="button"
              onClick={handleDelete}
              className={`${btn("danger")} flex-shrink-0`}
            >
              Confirm Delete
            </button>
            <button
              type="button"
              onClick={() => setDeleteConfirm(false)}
              className={`${btn("subtle")} flex-shrink-0`}
            >
              Cancel
            </button>
          </>
        ) : isOpen ? (
          <>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className={`${btn("success")} flex-shrink-0`}
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={onRequestClose}
              disabled={isSaving}
              className={`${btn("subtle")} flex-shrink-0`}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onRequestOpen}
              className={`${btn("primary")} flex-shrink-0`}
            >
              View / Edit
            </button>
            <button
              type="button"
              onClick={() => setDeleteConfirm(true)}
              className={`${btn("danger")} flex-shrink-0`}
            >
              Delete
            </button>
          </>
        )}
      </div>

      {isOpen && (
        <div className="px-3 pb-3 pt-2 border-t border-gray-200 space-y-3">
          <div className="px-2 py-1.5 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
            Click routes on the map to add or remove them from this journey
          </div>

          {isLoadingDetails ? (
            <div className="text-xs text-gray-500 text-center py-2">Loading…</div>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
