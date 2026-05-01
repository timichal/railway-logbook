'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/lib/toast';
import { getAllJourneys, deleteJourney, getJourney, updateJourney, addRoutesToJourney, removeRouteFromJourney, updateLoggedPartPartial } from '@/lib/journeyActions';
import { getAllTrips, assignJourneyToTrip, unassignJourneyFromTrip } from '@/lib/tripActions';
import type { TripWithStats } from '@/lib/tripActions';
import type { Journey, RailwayRoute, SelectedRoute } from '@/lib/types';
import { getUntimezonedDateStr } from '@/lib/getUntimezonedDateStr';

function buildRouteFromSelected(route: SelectedRoute): RailwayRoute {
  return {
    track_id: route.track_id,
    from_station: route.from_station,
    to_station: route.to_station,
    track_number: route.track_number ?? null,
    description: route.description,
    usage_type: 0 as RailwayRoute['usage_type'],
    frequency: [],
    link: route.link ?? null,
    geometry: '',
    length_km: route.length_km,
    partial: false,
  };
}

interface JourneyWithStats extends Journey {
  route_count: number;
  total_distance: string;
  trip_name: string | null;
}

interface JourneyLogTabProps {
  onHighlightRoutes?: (routeIds: number[]) => void;
  onJourneyChanged?: () => void;
  onJourneyEditStart?: (handler: (route: SelectedRoute) => void) => void;
  onJourneyEditEnd?: () => void;
}

export default function JourneyLogTab({
  onHighlightRoutes,
  onJourneyChanged,
  onJourneyEditStart,
  onJourneyEditEnd
}: JourneyLogTabProps) {
  const { showSuccess, showError } = useToast();
  const [journeys, setJourneys] = useState<JourneyWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [viewedJourneyId, setViewedJourneyId] = useState<number | null>(null);
  const [viewedJourneyRoutes, setViewedJourneyRoutes] = useState<RailwayRoute[]>([]);

  // Edit state
  const [editingJourneyId, setEditingJourneyId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTripId, setEditTripId] = useState<number | null>(null);

  // Snapshot taken when entering edit. Save() diffs current state vs this to
  // figure out which routes/partials/metadata to persist. Cancel() discards.
  const [originalSnapshot, setOriginalSnapshot] = useState<{
    routes: RailwayRoute[];
    name: string;
    date: string;
    description: string;
    tripId: number | null;
  } | null>(null);

  const [isSaving, setIsSaving] = useState(false);

  // Trips for assignment dropdown
  const [availableTrips, setAvailableTrips] = useState<TripWithStats[]>([]);

  // Ref to always expose fresh state to the stable map click handler
  const editStateRef = useRef({ editingJourneyId, viewedJourneyRoutes });
  editStateRef.current = { editingJourneyId, viewedJourneyRoutes };

  // Mutable handler ref updated every render so it always closes over latest state.
  // Edits are local until Save — no API calls here.
  const handleMapRouteClickRef = useRef<((route: SelectedRoute) => void) | undefined>(undefined);
  handleMapRouteClickRef.current = (route: SelectedRoute) => {
    const { editingJourneyId, viewedJourneyRoutes } = editStateRef.current;
    if (!editingJourneyId) return;

    // Use String() coercion because DB returns numeric track_id at runtime
    const routeId = String(route.track_id);
    const isInJourney = viewedJourneyRoutes.some(r => String(r.track_id) === routeId);

    const newRoutes = isInJourney
      ? viewedJourneyRoutes.filter(r => String(r.track_id) !== routeId)
      : [...viewedJourneyRoutes, buildRouteFromSelected(route)];

    setViewedJourneyRoutes(newRoutes);
    onHighlightRoutes?.(newRoutes.map(r => parseInt(r.track_id)).filter(id => !isNaN(id)));
  };

  // Stable wrapper passed to VectorRailwayMap once per edit session
  const stableHandleMapRouteClick = useCallback((route: SelectedRoute) => {
    handleMapRouteClickRef.current?.(route);
  }, []);

  // Load journeys on mount
  useEffect(() => {
    loadJourneys(true);
  }, []);

  // Clear highlights and edit mode when component unmounts (tab switched)
  useEffect(() => {
    return () => {
      onHighlightRoutes?.([]);
      onJourneyEditEnd?.();
    };
  }, [onHighlightRoutes, onJourneyEditEnd]);

  const loadJourneys = async (showSpinner = false) => {
    if (showSpinner) setIsLoading(true);
    try {
      const result = await getAllJourneys();
      if (result.error) {
        showError(result.error);
        setJourneys([]);
      } else {
        setJourneys(result.journeys || []);
      }
    } catch (error) {
      console.error('Error loading journeys:', error);
      showError('Failed to load journeys');
      setJourneys([]);
    } finally {
      setIsLoading(false);
    }
  };

  const closeEditMode = () => {
    setViewedJourneyId(null);
    setViewedJourneyRoutes([]);
    setEditingJourneyId(null);
    setOriginalSnapshot(null);
    onHighlightRoutes?.([]);
    onJourneyEditEnd?.();
  };

  const handleViewJourney = async (journeyId: number) => {
    // Toggle view - if already viewing this journey, treat as Cancel (discard edits)
    if (viewedJourneyId === journeyId) {
      closeEditMode();
      return;
    }

    try {
      const result = await getJourney(journeyId);
      if (result.error) {
        showError(result.error);
        return;
      }

      const routes = result.routes || [];
      setViewedJourneyId(journeyId);
      setViewedJourneyRoutes(routes);

      // Set up edit mode with current journey data
      if (result.journey) {
        setEditingJourneyId(journeyId);
        setEditName(result.journey.name);
        const dateStr = getUntimezonedDateStr(result.journey.date);
        setEditDate(dateStr);
        setEditDescription(result.journey.description || '');
        setEditTripId(result.journey.trip_id);
        setOriginalSnapshot({
          routes,
          name: result.journey.name,
          date: dateStr,
          description: result.journey.description || '',
          tripId: result.journey.trip_id,
        });

        // Load available trips for the dropdown
        const tripsResult = await getAllTrips();
        if (!tripsResult.error) {
          setAvailableTrips(tripsResult.trips || []);
        }
      }

      // Highlight routes on map and register map click handler
      if (onHighlightRoutes) {
        const routeIds = routes
          .map(r => r.track_id ? parseInt(r.track_id) : null)
          .filter((id): id is number => id !== null);
        onHighlightRoutes(routeIds);
      }
      onJourneyEditStart?.(stableHandleMapRouteClick);
    } catch (error) {
      console.error('Error viewing journey:', error);
      showError('Failed to load journey details');
    }
  };

  // Local-only edit handlers — actual persistence happens in handleSave
  const handleTogglePartial = (trackId: string, nextPartial: boolean) => {
    setViewedJourneyRoutes(prev =>
      prev.map(r => String(r.track_id) === String(trackId) ? { ...r, partial: nextPartial } : r)
    );
  };

  const handleRemoveRoute = (trackId: string) => {
    const newRoutes = viewedJourneyRoutes.filter(r => String(r.track_id) !== String(trackId));
    setViewedJourneyRoutes(newRoutes);
    onHighlightRoutes?.(newRoutes.map(r => parseInt(r.track_id)).filter(id => !isNaN(id)));
  };

  const handleTripChange = (newTripId: number | null) => {
    setEditTripId(newTripId);
  };

  const handleCancel = () => {
    closeEditMode();
  };

  const handleSave = async () => {
    if (!editingJourneyId || !originalSnapshot) return;

    const trimmedName = editName.trim();
    const trimmedDescription = editDescription.trim();

    if (!trimmedName || !editDate) {
      showError('Journey name and date are required');
      return;
    }

    setIsSaving(true);
    try {
      // 1. Metadata
      const metaChanged =
        trimmedName !== originalSnapshot.name ||
        editDate !== originalSnapshot.date ||
        trimmedDescription !== originalSnapshot.description;
      if (metaChanged) {
        const result = await updateJourney(
          editingJourneyId,
          trimmedName,
          trimmedDescription || null,
          editDate
        );
        if (result.error) { showError(result.error); return; }
      }

      // 2. Trip assignment
      if (editTripId !== originalSnapshot.tripId) {
        const result = editTripId
          ? await assignJourneyToTrip(editingJourneyId, editTripId)
          : await unassignJourneyFromTrip(editingJourneyId);
        if (result.error) { showError(result.error); return; }
      }

      // 3. Route diff: add new, remove dropped, update partial flag where it changed
      const origMap = new Map(originalSnapshot.routes.map(r => [String(r.track_id), r]));
      const editedMap = new Map(viewedJourneyRoutes.map(r => [String(r.track_id), r]));

      const toAdd: { trackId: number; partial: boolean }[] = [];
      const toUpdatePartial: { trackId: number; partial: boolean }[] = [];
      editedMap.forEach((edited, id) => {
        const orig = origMap.get(id);
        const partial = edited.partial ?? false;
        if (!orig) {
          toAdd.push({ trackId: parseInt(edited.track_id), partial });
        } else if ((orig.partial ?? false) !== partial) {
          toUpdatePartial.push({ trackId: parseInt(edited.track_id), partial });
        }
      });
      const toRemove: number[] = [];
      origMap.forEach((orig, id) => {
        if (!editedMap.has(id)) toRemove.push(parseInt(orig.track_id));
      });

      if (toAdd.length > 0) {
        const result = await addRoutesToJourney(
          editingJourneyId,
          toAdd.map(a => a.trackId),
          toAdd.map(a => a.partial)
        );
        if (result.error) { showError(result.error); return; }
      }
      for (const trackId of toRemove) {
        const result = await removeRouteFromJourney(editingJourneyId, trackId);
        if (result.error) { showError(result.error); return; }
      }
      for (const { trackId, partial } of toUpdatePartial) {
        const result = await updateLoggedPartPartial(editingJourneyId, trackId, partial);
        if (result.error) { showError(result.error); return; }
      }

      showSuccess('Journey updated');
      closeEditMode();
      loadJourneys();
      onJourneyChanged?.();
    } catch (error) {
      console.error('Error saving journey:', error);
      showError('Failed to save journey');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (journeyId: number) => {
    try {
      const result = await deleteJourney(journeyId);
      if (result.error) {
        showError(result.error);
      } else {
        showSuccess('Journey deleted successfully');
        // If we were viewing this journey, clear the view
        if (viewedJourneyId === journeyId) {
          closeEditMode();
        }
        loadJourneys(); // Reload list
        // Trigger map refresh to update route colors
        if (onJourneyChanged) {
          onJourneyChanged();
        }
      }
    } catch (error) {
      console.error('Error deleting journey:', error);
      showError('Failed to delete journey');
    } finally {
      setDeleteConfirmId(null);
    }
  };

  // Filter journeys by search query (name or date)
  const filteredJourneys = journeys.filter(journey => {
    const query = searchQuery.toLowerCase();
    const matchesName = journey.name.toLowerCase().includes(query);
    const matchesDate = String(journey.date).includes(query);
    const matchesDescription = journey.description?.toLowerCase().includes(query) || false;
    return matchesName || matchesDate || matchesDescription;
  });

  return (
    <div className="p-4 text-black space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-bold mb-2">My Journeys</h3>
        <p className="text-sm text-gray-600">
          View, edit, and manage your railway journeys
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
        {isLoading ? (
          <div className="text-center py-8 text-gray-500">
            Loading journeys...
          </div>
        ) : filteredJourneys.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {searchQuery
              ? 'No journeys match your search'
              : 'No journeys yet. Create your first journey in the Route Logger tab!'
            }
          </div>
        ) : (
          filteredJourneys.map((journey) => (
            <div
              key={journey.id}
              className="p-3 bg-white border border-gray-300 rounded shadow-sm"
            >
              {/* Journey Header */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-base truncate">{journey.name}</h4>
                    {journey.trip_name && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 flex-shrink-0">
                        {journey.trip_name}
                      </span>
                    )}
                  </div>
                  {journey.description && (
                    <div className="text-xs text-gray-600 mt-1">
                      {journey.description}
                    </div>
                  )}
                </div>
              </div>

              {/* Journey Stats */}
              <div className="flex items-center gap-4 text-xs text-gray-700 mb-3">
                <span className="font-medium">
                  {new Date(journey.date).toLocaleDateString('cs-CZ')}
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-medium">{journey.route_count}</span>
                  <span>routes</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-medium">{Number(journey.total_distance).toFixed(1)}</span>
                  <span>km</span>
                </span>
              </div>

              {/* Action Buttons */}
              {deleteConfirmId === journey.id ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDelete(journey.id)}
                    className="flex-1 px-3 py-1.5 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700"
                  >
                    Confirm Delete
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="flex-1 px-3 py-1.5 bg-gray-300 text-gray-700 rounded text-sm font-medium hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                </div>
              ) : viewedJourneyId === journey.id ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex-1 px-3 py-1.5 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={isSaving}
                    className="flex-1 px-3 py-1.5 bg-gray-300 text-gray-700 rounded text-sm font-medium hover:bg-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleViewJourney(journey.id)}
                    className="flex-1 px-3 py-1.5 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
                  >
                    View / Edit
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(journey.id)}
                    className="px-3 py-1.5 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700"
                  >
                    Delete
                  </button>
                </div>
              )}

              {/* Edit Form and Journey Details - shown when viewing */}
              {viewedJourneyId === journey.id && (
                <div className="mt-3 pt-3 border-t border-gray-200 space-y-3">
                  {/* Map interaction hint */}
                  <div className="px-2 py-1.5 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
                    Click routes on the map to add or remove them from this journey
                  </div>

                  {/* Edit Form */}
                  {editingJourneyId === journey.id && (
                    <div className="space-y-2">
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">
                        Edit Journey
                      </h5>
                      <div>
                        <label className="block text-xs font-medium mb-1">Journey Name*</label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Date*</label>
                        <input
                          type="date"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Description</label>
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={2}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Trip</label>
                        <select
                          value={editTripId ?? ''}
                          onChange={(e) => handleTripChange(e.target.value ? Number(e.target.value) : null)}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">None</option>
                          {availableTrips.map(trip => (
                            <option key={trip.id} value={trip.id}>{trip.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Routes List */}
                  <div>
                    <h5 className="text-sm font-semibold text-gray-700 mb-2">
                      Routes in this journey:
                    </h5>
                    {viewedJourneyRoutes.length === 0 ? (
                      <p className="text-xs text-gray-500 italic">No routes — click routes on the map to add them.</p>
                    ) : (
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {viewedJourneyRoutes.map((route) => (
                          <div
                            key={route.track_id}
                            className="p-2 bg-gray-50 border border-gray-200 rounded text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium truncate">
                                {route.track_number && `${route.track_number} `}
                                {route.from_station} ⟷ {route.to_station}
                              </span>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <label className="flex items-center gap-1 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={route.partial ?? false}
                                    onChange={() => handleTogglePartial(route.track_id, !(route.partial ?? false))}
                                    className="w-3 h-3 cursor-pointer"
                                  />
                                  <span className="text-gray-500">partial</span>
                                </label>
                                <button
                                  onClick={() => handleRemoveRoute(route.track_id)}
                                  title="Remove route from journey"
                                  className="w-6 h-6 flex items-center justify-center rounded bg-red-100 text-red-700 hover:bg-red-200"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Status Info */}
      {!isLoading && filteredJourneys.length > 0 && (
        <div className="text-xs text-gray-600 text-center pt-2 border-t">
          Showing {filteredJourneys.length} of {journeys.length} journeys
        </div>
      )}
    </div>
  );
}
