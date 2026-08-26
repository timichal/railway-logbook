"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getUntimezonedDateStr } from "@/lib/getUntimezonedDateStr";
import * as localStore from "@/lib/localStorage";
import { useRegionId } from "@/lib/regionContext";
import { useToast } from "@/lib/toast";
import type {
  HighlightRoutesFn,
  JourneyEditStartFn,
  LocalJourney,
  LocalLoggedPart,
  RailwayRoute,
  SelectedRoute,
} from "@/lib/types";
import { btn, iconBtn } from "@/lib/ui/buttonStyles";
import { getRegionTrackIds, getRoutesByIds } from "@/lib/userActions";

interface JourneyWithRoutes {
  journey: LocalJourney;
  parts: LocalLoggedPart[];
}

interface LocalJourneyLogTabProps {
  onHighlightRoutes?: HighlightRoutesFn;
  onJourneyChanged?: () => void;
  onJourneyEditStart?: JourneyEditStartFn;
  onJourneyEditEnd?: () => void;
}

// Build a minimal RailwayRoute for display from a route clicked on the map.
function buildRouteMetaFromSelected(route: SelectedRoute): RailwayRoute {
  return {
    track_id: route.track_id,
    from_station: route.from_station,
    to_station: route.to_station,
    description: route.description,
    usage_type: 0 as RailwayRoute["usage_type"],
    frequency: [],
    link: route.link,
    geometry: "",
    length_km: route.length_km,
  };
}

export default function LocalJourneyLogTab({
  onHighlightRoutes,
  onJourneyChanged,
  onJourneyEditStart,
  onJourneyEditEnd,
}: LocalJourneyLogTabProps) {
  const { showSuccess, showError } = useToast();
  const regionId = useRegionId();
  const [journeys, setJourneys] = useState<JourneyWithRoutes[]>([]);
  // Track ids of the region on screen. A localStorage journey knows only track
  // ids, so this is what tells the list which journeys belong here; null while
  // it loads, and then everything is shown rather than nothing.
  const [regionTrackIds, setRegionTrackIds] = useState<Set<number> | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [viewedJourneyId, setViewedJourneyId] = useState<string | null>(null);
  // Route metadata (station names, length, …) keyed by track_id. The localStorage
  // parts only store track_id, so we fetch the rest on demand for display.
  const [routeMeta, setRouteMeta] = useState<Record<number, RailwayRoute>>({});

  // Edit state
  const [editingJourneyId, setEditingJourneyId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editDescription, setEditDescription] = useState("");

  // The region's track ids, refetched when the region changes. Any journey open
  // at the time is collapsed: it may not be in this region at all, and its
  // highlight is dropped by the map anyway.
  useEffect(() => {
    let cancelled = false;
    setRegionTrackIds(null);
    setViewedJourneyId(null);
    getRegionTrackIds(regionId)
      .then((ids) => {
        if (!cancelled) setRegionTrackIds(new Set(ids));
      })
      .catch((error) => console.error("Error loading region route ids:", error));
    return () => {
      cancelled = true;
    };
  }, [regionId]);

  // Load journeys on mount and when storage changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadJourneys only needs to run on mount; the storage listener handles subsequent reloads.
  useEffect(() => {
    loadJourneys();

    // Listen for storage changes from other tabs
    const cleanup = localStore.onStorageChange(() => {
      loadJourneys();
    });

    return cleanup;
  }, []);

  // Clear highlights when component unmounts (tab switched)
  useEffect(() => {
    return () => {
      if (onHighlightRoutes) {
        onHighlightRoutes([]);
      }
    };
  }, [onHighlightRoutes]);

  const loadJourneys = () => {
    const allJourneys = localStore.getJourneys();
    const allParts = localStore.getLoggedParts();

    const journeysWithRoutes: JourneyWithRoutes[] = allJourneys.map((journey) => ({
      journey,
      parts: allParts.filter((part) => part.journey_id === journey.id),
    }));

    // Sort by date descending
    journeysWithRoutes.sort(
      (a, b) => new Date(b.journey.date).getTime() - new Date(a.journey.date).getTime(),
    );

    setJourneys(journeysWithRoutes);
  };

  // Fetch metadata for any track_ids we don't already have cached.
  const loadRouteMeta = useCallback(
    async (trackIds: number[]) => {
      const missing = trackIds.filter((id) => !(id in routeMeta));
      if (missing.length === 0) return;
      try {
        const routes = await getRoutesByIds(missing);
        setRouteMeta((prev) => {
          const next = { ...prev };
          for (const route of routes) {
            next[route.track_id] = route;
          }
          return next;
        });
      } catch (error) {
        console.error("Error loading route metadata:", error);
      }
    },
    [routeMeta],
  );

  // Map route clicks (while a journey is open) toggle that route in/out of the
  // journey. Kept in a ref so the stable callback registered with the map always
  // sees fresh state, mirroring JourneyCard's approach.
  const handleMapRouteClickRef = useRef<((route: SelectedRoute) => void) | null>(null);
  handleMapRouteClickRef.current = (route: SelectedRoute) => {
    if (!viewedJourneyId) return;
    const trackId = route.track_id;

    try {
      const existing = localStore
        .getLoggedPartsByJourneyId(viewedJourneyId)
        .find((p) => p.track_id === trackId);
      if (existing) {
        localStore.deleteLoggedPart(existing.id);
      } else {
        localStore.addLoggedPart({
          journey_id: viewedJourneyId,
          track_id: trackId,
          partial: false,
        });
        // Cache metadata from the clicked route for instant display.
        setRouteMeta((prev) => ({ ...prev, [trackId]: buildRouteMetaFromSelected(route) }));
      }

      loadJourneys();
      const remaining = localStore.getLoggedPartsByJourneyId(viewedJourneyId);
      onHighlightRoutes?.(remaining.map((p) => p.track_id));
      onJourneyChanged?.();
    } catch (error) {
      console.error("Error toggling route in journey:", error);
      showError(error instanceof Error ? error.message : "Failed to update journey");
    }
  };

  const stableHandleMapRouteClick = useCallback((route: SelectedRoute) => {
    handleMapRouteClickRef.current?.(route);
  }, []);

  // Same ref dance, for the touch sheet's button label ("Add to journey" vs
  // "Remove from journey") — the map holds this for the whole edit session.
  const isRouteInJourneyRef = useRef<((trackId: number) => boolean) | null>(null);
  isRouteInJourneyRef.current = (trackId: number) => {
    if (!viewedJourneyId) return false;
    return localStore
      .getLoggedPartsByJourneyId(viewedJourneyId)
      .some((p) => p.track_id === trackId);
  };
  const stableIsRouteInJourney = useCallback(
    (trackId: number) => isRouteInJourneyRef.current?.(trackId) ?? false,
    [],
  );

  // Register the map click handler while a journey is open; tear it down when it
  // closes or the tab unmounts.
  useEffect(() => {
    if (!viewedJourneyId) return;
    onJourneyEditStart?.(stableHandleMapRouteClick, stableIsRouteInJourney);
    return () => {
      onJourneyEditEnd?.();
    };
  }, [
    viewedJourneyId,
    stableHandleMapRouteClick,
    stableIsRouteInJourney,
    onJourneyEditStart,
    onJourneyEditEnd,
  ]);

  const handleViewJourney = (journeyId: string) => {
    // Toggle view - if already viewing this journey, collapse it
    if (viewedJourneyId === journeyId) {
      setViewedJourneyId(null);
      setEditingJourneyId(null);
      if (onHighlightRoutes) {
        onHighlightRoutes([]);
      }
      return;
    }

    const journeyData = journeys.find((j) => j.journey.id === journeyId);
    if (!journeyData) return;

    setViewedJourneyId(journeyId);

    // Set up edit mode with current journey data
    setEditingJourneyId(journeyId);
    setEditName(journeyData.journey.name);
    const dateStr = getUntimezonedDateStr(journeyData.journey.date);
    setEditDate(dateStr);
    setEditDescription(journeyData.journey.description || "");

    // Highlight routes on map
    const routeIds = journeyData.parts.map((p) => p.track_id);
    if (onHighlightRoutes) {
      onHighlightRoutes(routeIds);
    }

    // Fetch route metadata for richer display
    loadRouteMeta(routeIds);
  };

  const handleSaveEdit = () => {
    if (!editingJourneyId) return;

    if (!editName.trim() || !editDate) {
      showError("Journey name and date are required");
      return;
    }

    try {
      localStore.updateJourney(editingJourneyId, {
        name: editName.trim(),
        description: editDescription.trim() || null,
        date: editDate,
      });

      showSuccess("Journey updated successfully");
      loadJourneys();

      // Trigger map refresh
      if (onJourneyChanged) {
        onJourneyChanged();
      }
    } catch (error) {
      console.error("Error updating journey:", error);
      showError("Failed to update journey");
    }
  };

  const handleCancelEdit = () => {
    // Restore original values from the journey
    const journeyData = journeys.find((j) => j.journey.id === editingJourneyId);
    if (journeyData) {
      setEditName(journeyData.journey.name);
      const dateStr = getUntimezonedDateStr(journeyData.journey.date);
      setEditDate(dateStr);
      setEditDescription(journeyData.journey.description || "");
    }
  };

  const handleDelete = (journeyId: string) => {
    try {
      localStore.deleteJourney(journeyId);
      showSuccess("Journey deleted successfully");

      // If we were viewing this journey, clear the view
      if (viewedJourneyId === journeyId) {
        setViewedJourneyId(null);
        if (onHighlightRoutes) {
          onHighlightRoutes([]);
        }
      }

      loadJourneys();

      // Trigger map refresh to update route colors
      if (onJourneyChanged) {
        onJourneyChanged();
      }
    } catch (error) {
      console.error("Error deleting journey:", error);
      showError("Failed to delete journey");
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleDeletePart = (partId: string) => {
    try {
      localStore.deleteLoggedPart(partId);
      showSuccess("Route removed from journey");
      loadJourneys();

      // Re-highlight the remaining routes of the journey being viewed
      if (viewedJourneyId && onHighlightRoutes) {
        const remaining = localStore.getLoggedPartsByJourneyId(viewedJourneyId);
        onHighlightRoutes(remaining.map((p) => p.track_id));
      }

      // Trigger map refresh
      if (onJourneyChanged) {
        onJourneyChanged();
      }
    } catch (error) {
      console.error("Error deleting logged part:", error);
      showError("Failed to remove route");
    }
  };

  const handleTogglePartial = (partId: string, currentPartial: boolean) => {
    try {
      localStore.updateLoggedPart(partId, !currentPartial);
      loadJourneys();

      // Trigger map refresh
      if (onJourneyChanged) {
        onJourneyChanged();
      }
    } catch (error) {
      console.error("Error updating partial flag:", error);
      showError("Failed to update partial flag");
    }
  };

  // Journeys of the region on screen. One with no routes logged yet belongs to
  // every region, mirroring how the database journey list treats an empty one.
  const regionJourneys = useMemo(() => {
    if (!regionTrackIds) return journeys;
    return journeys.filter(
      ({ parts }) => parts.length === 0 || parts.some((part) => regionTrackIds.has(part.track_id)),
    );
  }, [journeys, regionTrackIds]);

  // Filter journeys by search query
  const filteredJourneys = regionJourneys.filter(({ journey }) => {
    const query = searchQuery.toLowerCase();
    const matchesName = journey.name.toLowerCase().includes(query);
    const matchesDate = String(journey.date).includes(query);
    const matchesDescription = journey.description?.toLowerCase().includes(query) || false;
    return matchesName || matchesDate || matchesDescription;
  });

  return (
    <div className="p-4 text-fg space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-bold mb-2">My Journeys (Local Storage)</h3>
        <p className="text-sm text-gray-600">
          View and manage your railway journeys ({journeys.length}/5 used)
        </p>
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name, date, or description..."
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Journey List */}
      <div className="space-y-2">
        {filteredJourneys.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {searchQuery
              ? "No journeys match your search"
              : "No journeys yet. Create your first journey in the Route Logger tab!"}
          </div>
        ) : (
          filteredJourneys.map(({ journey, parts }) => (
            <div
              key={journey.id}
              className="p-3 bg-surface border border-gray-300 rounded shadow-sm"
            >
              {/* Journey Header */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-base truncate">{journey.name}</h4>
                  {journey.description && (
                    <div className="text-xs text-gray-600 mt-1">{journey.description}</div>
                  )}
                </div>
              </div>

              {/* Journey Stats */}
              <div className="flex items-center gap-4 text-xs text-gray-700 mb-3">
                <span className="font-medium">
                  {new Date(journey.date).toLocaleDateString("cs-CZ")}
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-medium">{parts.length}</span>
                  <span>routes</span>
                </span>
              </div>

              {/* Action Buttons */}
              {deleteConfirmId === journey.id ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDelete(journey.id)}
                    className={`${btn("danger")} flex-1`}
                  >
                    Confirm Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmId(null)}
                    className={`${btn("subtle")} flex-1`}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleViewJourney(journey.id)}
                    className={`${btn(viewedJourneyId === journey.id ? "warning" : "primary")} flex-1`}
                  >
                    {viewedJourneyId === journey.id ? "Hide Details" : "View / Edit"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmId(journey.id)}
                    className={btn("danger")}
                  >
                    Delete
                  </button>
                </div>
              )}

              {/* Edit Form and Journey Details - shown when viewing */}
              {viewedJourneyId === journey.id && (
                <div className="mt-3 pt-3 border-t border-gray-200 space-y-3">
                  <div className="px-2 py-1.5 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
                    Click routes on the map to add or remove them from this journey
                  </div>

                  {/* Edit Form */}
                  {editingJourneyId === journey.id && (
                    <div className="space-y-2">
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">Edit Journey</h5>
                      <div>
                        <label
                          htmlFor={`local-journey-${journey.id}-name`}
                          className="block text-xs font-medium mb-1"
                        >
                          Journey Name*
                        </label>
                        <input
                          id={`local-journey-${journey.id}-name`}
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`local-journey-${journey.id}-date`}
                          className="block text-xs font-medium mb-1"
                        >
                          Date*
                        </label>
                        <input
                          id={`local-journey-${journey.id}-date`}
                          type="date"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`local-journey-${journey.id}-description`}
                          className="block text-xs font-medium mb-1"
                        >
                          Description
                        </label>
                        <textarea
                          id={`local-journey-${journey.id}-description`}
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={2}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSaveEdit}
                          disabled={!editName.trim() || !editDate}
                          className={`${btn("success", "xs")} flex-1`}
                        >
                          Save Changes
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          className={`${btn("subtle", "xs")} flex-1`}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Routes List */}
                  {parts.length > 0 && (
                    <div>
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">
                        Routes in this journey:
                      </h5>
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {parts.map((part) => {
                          const meta = routeMeta[part.track_id];
                          return (
                            <div
                              key={part.id}
                              className="p-2 bg-gray-50 border border-gray-200 rounded text-xs"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium truncate">
                                  {meta ? (
                                    <>
                                      {meta.from_station} ⟷ {meta.to_station}
                                    </>
                                  ) : (
                                    `Route #${part.track_id}`
                                  )}
                                </span>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <label className="flex items-center gap-1.5 select-none min-h-11 md:min-h-0 px-1 md:px-0">
                                    <input
                                      type="checkbox"
                                      checked={part.partial}
                                      onChange={() => handleTogglePartial(part.id, part.partial)}
                                      className="w-4 h-4"
                                    />
                                    <span className="text-gray-500">partial</span>
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => handleDeletePart(part.id)}
                                    title="Remove route from journey"
                                    className={iconBtn("responsive", "danger")}
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
                              {meta?.length_km != null && (
                                <div className="text-gray-500 mt-0.5">
                                  {Number(meta.length_km).toFixed(1)} km
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Status Info */}
      {filteredJourneys.length > 0 && (
        <div className="text-xs text-gray-600 text-center pt-2 border-t">
          Showing {filteredJourneys.length} of {regionJourneys.length} journeys
        </div>
      )}
    </div>
  );
}
