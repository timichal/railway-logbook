"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getUntimezonedDateStr } from "@/lib/getUntimezonedDateStr";
import {
  addRoutesToJourney,
  deleteJourney,
  getJourney,
  removeRouteFromJourney,
  updateJourney,
  updateLoggedPartPartial,
} from "@/lib/journeyActions";
import { useToast } from "@/lib/toast";
import type { TripWithStats } from "@/lib/tripActions";
import { assignJourneyToTrip, unassignJourneyFromTrip } from "@/lib/tripActions";
import type { Journey, RailwayRoute, SelectedRoute } from "@/lib/types";

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

interface MergedJourneyCardProps {
  journey: JourneyDisplay;
  availableTrips: TripWithStats[];
  // Tells parent whether this card is the currently-open one. Parent enforces single-open.
  isOpen: boolean;
  onRequestOpen: () => void;
  onRequestClose: () => void;
  // Mutation lifecycle
  onChanged: () => void; // After save/delete/route changes — refresh the list and map
  // Map interaction
  onHighlightRoutes?: (routeIds: number[], kind?: "planner" | "view") => void;
  onJourneyEditStart?: (handler: (route: SelectedRoute) => void) => void;
  onJourneyEditEnd?: () => void;
  // Visual nesting (when rendered inside a trip card)
  nested?: boolean;
}

export default function MergedJourneyCard({
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
}: MergedJourneyCardProps) {
  const { showSuccess, showError } = useToast();

  const [viewedRoutes, setViewedRoutes] = useState<RailwayRoute[]>([]);
  const [editName, setEditName] = useState(journey.name);
  const [editDate, setEditDate] = useState(getUntimezonedDateStr(journey.date));
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

  // Load journey details when this card opens
  // biome-ignore lint/correctness/useExhaustiveDependencies: onHighlightRoutes is intentionally omitted; the effect should fire only when the card opens or the journey changes, not when the callback identity changes.
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setIsLoadingDetails(true);
    (async () => {
      const result = await getJourney(journey.id);
      if (cancelled) return;
      if (result.error) {
        showError(result.error);
        setIsLoadingDetails(false);
        return;
      }
      const routes = result.routes || [];
      setViewedRoutes(routes);
      if (result.journey) {
        const dateStr = getUntimezonedDateStr(result.journey.date);
        setEditName(result.journey.name);
        setEditDate(dateStr);
        setEditDescription(result.journey.description || "");
        setEditTripId(result.journey.trip_id);
        setOriginalSnapshot({
          routes,
          name: result.journey.name,
          date: dateStr,
          description: result.journey.description || "",
          tripId: result.journey.trip_id,
        });
      }
      setIsLoadingDetails(false);
      onHighlightRoutes?.(routes.map((r) => r.track_id));
      onJourneyEditStart?.(stableHandleMapRouteClick);
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, journey.id]);

  // When this card closes (or unmounts), tear down the edit session
  // biome-ignore lint/correctness/useExhaustiveDependencies: onJourneyEditEnd is intentionally omitted; the teardown should fire only on the open→closed transition, not when the callback identity changes.
  useEffect(() => {
    if (isOpen) return;
    setViewedRoutes([]);
    setOriginalSnapshot(null);
    setDeleteConfirm(false);
    onJourneyEditEnd?.();
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

    setIsSaving(true);
    try {
      const metaChanged =
        trimmedName !== originalSnapshot.name ||
        editDate !== originalSnapshot.date ||
        trimmedDescription !== originalSnapshot.description;
      if (metaChanged) {
        const result = await updateJourney(
          journey.id,
          trimmedName,
          trimmedDescription || null,
          editDate,
        );
        if (result.error) {
          showError(result.error);
          return;
        }
      }

      if (editTripId !== originalSnapshot.tripId) {
        const result = editTripId
          ? await assignJourneyToTrip(journey.id, editTripId)
          : await unassignJourneyFromTrip(journey.id);
        if (result.error) {
          showError(result.error);
          return;
        }
      }

      const origMap = new Map(originalSnapshot.routes.map((r) => [r.track_id, r]));
      const editedMap = new Map(viewedRoutes.map((r) => [r.track_id, r]));

      const toAdd: { trackId: number; partial: boolean }[] = [];
      const toUpdatePartial: { trackId: number; partial: boolean }[] = [];
      editedMap.forEach((edited, id) => {
        const orig = origMap.get(id);
        const partial = edited.partial ?? false;
        if (!orig) {
          toAdd.push({ trackId: edited.track_id, partial });
        } else if ((orig.partial ?? false) !== partial) {
          toUpdatePartial.push({ trackId: edited.track_id, partial });
        }
      });
      const toRemove: number[] = [];
      origMap.forEach((orig, id) => {
        if (!editedMap.has(id)) toRemove.push(orig.track_id);
      });

      if (toAdd.length > 0) {
        const result = await addRoutesToJourney(
          journey.id,
          toAdd.map((a) => a.trackId),
          toAdd.map((a) => a.partial),
        );
        if (result.error) {
          showError(result.error);
          return;
        }
      }
      for (const trackId of toRemove) {
        const result = await removeRouteFromJourney(journey.id, trackId);
        if (result.error) {
          showError(result.error);
          return;
        }
      }
      for (const { trackId, partial } of toUpdatePartial) {
        const result = await updateLoggedPartPartial(journey.id, trackId, partial);
        if (result.error) {
          showError(result.error);
          return;
        }
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
      className={`border rounded shadow-sm ${nested ? "bg-gray-50 border-gray-200" : "bg-white border-gray-300"}`}
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
            {new Date(journey.date).toLocaleDateString()} · {journey.route_count} route
            {journey.route_count === 1 ? "" : "s"} · {Number(journey.total_distance).toFixed(1)} km
          </div>
        </div>
        {deleteConfirm ? (
          <>
            <button
              type="button"
              onClick={handleDelete}
              className="px-3 py-1.5 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 flex-shrink-0"
            >
              Confirm Delete
            </button>
            <button
              type="button"
              onClick={() => setDeleteConfirm(false)}
              className="px-3 py-1.5 bg-gray-300 text-gray-700 rounded text-sm font-medium hover:bg-gray-400 flex-shrink-0"
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
              className="px-3 py-1.5 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={onRequestClose}
              disabled={isSaving}
              className="px-3 py-1.5 bg-gray-300 text-gray-700 rounded text-sm font-medium hover:bg-gray-400 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onRequestOpen}
              className="px-3 py-1.5 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 flex-shrink-0"
            >
              View / Edit
            </button>
            <button
              type="button"
              onClick={() => setDeleteConfirm(true)}
              className="px-3 py-1.5 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 flex-shrink-0"
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
              <div className="space-y-2">
                <h5 className="text-sm font-semibold text-gray-700 mb-2">Edit Journey</h5>
                <div>
                  <label
                    htmlFor={`journey-${journey.id}-name`}
                    className="block text-xs font-medium mb-1"
                  >
                    Journey Name*
                  </label>
                  <input
                    id={`journey-${journey.id}-name`}
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`journey-${journey.id}-date`}
                    className="block text-xs font-medium mb-1"
                  >
                    Date*
                  </label>
                  <input
                    id={`journey-${journey.id}-date`}
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`journey-${journey.id}-description`}
                    className="block text-xs font-medium mb-1"
                  >
                    Description
                  </label>
                  <textarea
                    id={`journey-${journey.id}-description`}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={2}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`journey-${journey.id}-trip`}
                    className="block text-xs font-medium mb-1"
                  >
                    Trip
                  </label>
                  <select
                    id={`journey-${journey.id}-trip`}
                    value={editTripId ?? ""}
                    onChange={(e) => setEditTripId(e.target.value ? Number(e.target.value) : null)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">None</option>
                    {availableTrips.map((trip) => (
                      <option key={trip.id} value={trip.id}>
                        {trip.name}
                      </option>
                    ))}
                  </select>
                </div>
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
                      <div
                        key={route.track_id}
                        className="p-2 bg-white border border-gray-200 rounded text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">
                            {route.from_station} ⟷ {route.to_station}
                          </span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <label className="flex items-center gap-1 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={route.partial ?? false}
                                onChange={() =>
                                  handleTogglePartial(route.track_id, !(route.partial ?? false))
                                }
                                className="w-3 h-3 cursor-pointer"
                              />
                              <span className="text-gray-500">partial</span>
                            </label>
                            <button
                              type="button"
                              onClick={() => handleRemoveRoute(route.track_id)}
                              title="Remove route from journey"
                              className="w-6 h-6 flex items-center justify-center rounded bg-red-100 text-red-700 hover:bg-red-200"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6" />
                                <path d="M14 11v6" />
                                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          </div>
                        </div>
                        <div className="text-gray-500 mt-0.5">
                          {Number(route.length_km)?.toFixed(1)} km
                        </div>
                      </div>
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
