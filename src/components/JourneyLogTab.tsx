'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/lib/toast';
import { getAllJourneys, deleteJourney, getJourney, updateJourney, addRoutesToJourney, removeRouteFromJourney, updateLoggedPartPartial } from '@/lib/journeyActions';
import { getAllTrips, assignJourneyToTrip, unassignJourneyFromTrip } from '@/lib/tripActions';
import type { TripWithStats } from '@/lib/tripActions';
import type { Journey, RailwayRoute, SelectedRoute } from '@/lib/types';
import { getUntimezonedDateStr } from '@/lib/getUntimezonedDateStr';

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
  const [originalJourneyRoutes, setOriginalJourneyRoutes] = useState<RailwayRoute[]>([]);

  // Edit state
  const [editingJourneyId, setEditingJourneyId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTripId, setEditTripId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Trips for assignment dropdown
  const [availableTrips, setAvailableTrips] = useState<TripWithStats[]>([]);

  // Ref to always expose fresh state to the stable map click handler
  const editStateRef = useRef({ editingJourneyId, viewedJourneyRoutes });
  editStateRef.current = { editingJourneyId, viewedJourneyRoutes };

  // Mutable handler ref updated every render so it always closes over latest state.
  // Only updates local state — DB writes happen on Save Changes.
  const handleMapRouteClickRef = useRef<((route: SelectedRoute) => void) | undefined>(undefined);
  handleMapRouteClickRef.current = (route: SelectedRoute) => {
    const { editingJourneyId, viewedJourneyRoutes } = editStateRef.current;
    if (!editingJourneyId) return;

    // Use String() coercion because DB returns numeric track_id at runtime
    const routeId = String(route.track_id);
    const isInJourney = viewedJourneyRoutes.some(r => String(r.track_id) === routeId);

    let newRoutes: RailwayRoute[];
    if (isInJourney) {
      newRoutes = viewedJourneyRoutes.filter(r => String(r.track_id) !== routeId);
    } else {
      const newRoute: RailwayRoute = {
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
      newRoutes = [...viewedJourneyRoutes, newRoute];
    }

    setViewedJourneyRoutes(newRoutes);
    onHighlightRoutes?.(newRoutes.map(r => parseInt(r.track_id)).filter(id => !isNaN(id)));
  };

  // Stable wrapper passed to VectorRailwayMap once per edit session
  const stableHandleMapRouteClick = useCallback((route: SelectedRoute) => {
    handleMapRouteClickRef.current?.(route);
  }, []);

  // Load journeys on mount
  useEffect(() => {
    loadJourneys();
  }, []);

  // Clear highlights and edit mode when component unmounts (tab switched)
  useEffect(() => {
    return () => {
      onHighlightRoutes?.([]);
      onJourneyEditEnd?.();
    };
  }, [onHighlightRoutes, onJourneyEditEnd]);

  const loadJourneys = async () => {
    setIsLoading(true);
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

  const handleViewJourney = async (journeyId: number) => {
    // Toggle view - if already viewing this journey, collapse it
    if (viewedJourneyId === journeyId) {
      setViewedJourneyId(null);
      setViewedJourneyRoutes([]);
      setOriginalJourneyRoutes([]);
      setEditingJourneyId(null);
      onHighlightRoutes?.([]);
      onJourneyEditEnd?.();
      return;
    }

    try {
      const result = await getJourney(journeyId);
      if (result.error) {
        showError(result.error);
        return;
      }

      setViewedJourneyId(journeyId);
      setViewedJourneyRoutes(result.routes || []);
      setOriginalJourneyRoutes(result.routes || []);

      // Set up edit mode with current journey data
      if (result.journey) {
        setEditingJourneyId(journeyId);
        setEditName(result.journey.name);
        const dateStr = getUntimezonedDateStr(result.journey.date);
        setEditDate(dateStr);
        setEditDescription(result.journey.description || '');
        setEditTripId(result.journey.trip_id);

        // Load available trips for the dropdown
        const tripsResult = await getAllTrips();
        if (!tripsResult.error) {
          setAvailableTrips(tripsResult.trips || []);
        }
      }

      // Highlight routes on map and register map click handler
      if (onHighlightRoutes) {
        const routeIds = result.routes
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

  const handleSaveEdit = async () => {
    if (!editingJourneyId) return;

    if (!editName.trim() || !editDate) {
      showError('Journey name and date are required');
      return;
    }

    setIsSaving(true);
    try {
      // Save journey metadata
      const result = await updateJourney(
        editingJourneyId,
        editName.trim(),
        editDescription.trim() || null,
        editDate
      );
      if (result.error) {
        showError(result.error);
        return;
      }

      // Apply pending route changes (diff against original)
      const originalIds = new Set(originalJourneyRoutes.map(r => String(r.track_id)));
      const pendingIds = new Set(viewedJourneyRoutes.map(r => String(r.track_id)));

      const toAdd = viewedJourneyRoutes.filter(r => !originalIds.has(String(r.track_id)));
      const toRemove = originalJourneyRoutes.filter(r => !pendingIds.has(String(r.track_id)));

      if (toAdd.length > 0) {
        const addResult = await addRoutesToJourney(
          editingJourneyId,
          toAdd.map(r => parseInt(r.track_id)),
          toAdd.map(r => r.partial ?? false)
        );
        if (addResult.error) {
          showError(addResult.error);
          return;
        }
      }

      for (const route of toRemove) {
        const removeResult = await removeRouteFromJourney(editingJourneyId, parseInt(route.track_id));
        if (removeResult.error) {
          showError(removeResult.error);
          return;
        }
      }

      // Update partial flags for routes that existed before and had their partial changed
      for (const route of viewedJourneyRoutes) {
        const original = originalJourneyRoutes.find(r => String(r.track_id) === String(route.track_id));
        if (original && (original.partial ?? false) !== (route.partial ?? false)) {
          const partialResult = await updateLoggedPartPartial(
            editingJourneyId,
            parseInt(route.track_id),
            route.partial ?? false
          );
          if (partialResult.error) {
            showError(partialResult.error);
            return;
          }
        }
      }

      // Commit: pending routes are now the new original
      setOriginalJourneyRoutes(viewedJourneyRoutes);
      showSuccess('Journey updated successfully');
      loadJourneys();
      onJourneyChanged?.();
    } catch (error) {
      console.error('Error updating journey:', error);
      showError('Failed to update journey');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    // Restore original metadata from the journey list
    const journey = journeys.find(j => j.id === editingJourneyId);
    if (journey) {
      setEditName(journey.name);
      const dateStr = getUntimezonedDateStr(journey.date);
      setEditDate(dateStr);
      setEditDescription(journey.description || '');
      setEditTripId(journey.trip_id);
    }
    // Revert pending route changes
    setViewedJourneyRoutes(originalJourneyRoutes);
    onHighlightRoutes?.(originalJourneyRoutes.map(r => parseInt(r.track_id)).filter(id => !isNaN(id)));
  };

  const handleTripChange = async (journeyId: number, newTripId: number | null) => {
    try {
      let result;
      if (newTripId) {
        result = await assignJourneyToTrip(journeyId, newTripId);
      } else {
        result = await unassignJourneyFromTrip(journeyId);
      }

      if (result.error) {
        showError(result.error);
      } else {
        setEditTripId(newTripId);
        showSuccess(newTripId ? 'Journey assigned to trip' : 'Journey unassigned from trip');
        loadJourneys();
        if (onJourneyChanged) onJourneyChanged();
      }
    } catch (error) {
      console.error('Error changing trip assignment:', error);
      showError('Failed to change trip assignment');
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
          setViewedJourneyId(null);
          setViewedJourneyRoutes([]);
          onHighlightRoutes?.([]);
          onJourneyEditEnd?.();
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
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleViewJourney(journey.id)}
                    className={`flex-1 px-3 py-1.5 rounded text-sm font-medium ${viewedJourneyId === journey.id
                      ? 'bg-amber-600 text-white hover:bg-amber-700'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                  >
                    {viewedJourneyId === journey.id ? 'Hide Details' : 'View / Edit'}
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
                          disabled={isSaving}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Date*</label>
                        <input
                          type="date"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={isSaving}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Description</label>
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={2}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                          disabled={isSaving}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Trip</label>
                        <select
                          value={editTripId ?? ''}
                          onChange={(e) => {
                            const val = e.target.value ? Number(e.target.value) : null;
                            handleTripChange(journey.id, val);
                          }}
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
                              <label className="flex items-center gap-1 flex-shrink-0 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={route.partial ?? false}
                                  onChange={() => setViewedJourneyRoutes(prev =>
                                    prev.map(r => String(r.track_id) === String(route.track_id)
                                      ? { ...r, partial: !(r.partial ?? false) }
                                      : r
                                    )
                                  )}
                                  disabled={isSaving}
                                  className="w-3 h-3 cursor-pointer"
                                />
                                <span className="text-gray-500">partial</span>
                              </label>
                            </div>
                            <div className="text-gray-500 mt-0.5">
                              {Number(route.length_km)?.toFixed(1)} km
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Save/Cancel */}
                  {editingJourneyId === journey.id && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSaveEdit}
                        disabled={isSaving || !editName.trim() || !editDate}
                        className={`flex-1 px-3 py-1.5 rounded text-xs font-medium ${isSaving || !editName.trim() || !editDate
                          ? 'bg-gray-400 text-white cursor-not-allowed'
                          : 'bg-green-600 text-white hover:bg-green-700'
                          }`}
                      >
                        {isSaving ? 'Saving...' : 'Save Changes'}
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        disabled={isSaving}
                        className="flex-1 px-3 py-1.5 bg-gray-300 text-gray-700 rounded text-xs font-medium hover:bg-gray-400"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
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
