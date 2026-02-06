'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/lib/toast';
import { getAllJourneys, deleteJourney, getJourney, updateJourney } from '@/lib/journeyActions';
import { getAllTrips, assignJourneyToTrip, unassignJourneyFromTrip } from '@/lib/tripActions';
import type { TripWithStats } from '@/lib/tripActions';
import type { Journey, RailwayRoute } from '@/lib/types';
import { getUntimezonedDateStr } from '@/lib/getUntimezonedDateStr';

interface JourneyWithStats extends Journey {
  route_count: number;
  total_distance: string;
  trip_name: string | null;
}

interface JourneyLogTabProps {
  onHighlightRoutes?: (routeIds: number[]) => void;
  onJourneyChanged?: () => void;
}

export default function JourneyLogTab({
  onHighlightRoutes,
  onJourneyChanged
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
  const [isSaving, setIsSaving] = useState(false);

  // Trips for assignment dropdown
  const [availableTrips, setAvailableTrips] = useState<TripWithStats[]>([]);

  // Load journeys on mount
  useEffect(() => {
    loadJourneys();
  }, []);

  // Clear highlights when component unmounts (tab switched)
  useEffect(() => {
    return () => {
      if (onHighlightRoutes) {
        onHighlightRoutes([]);
      }
    };
  }, [onHighlightRoutes]);

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
      setEditingJourneyId(null);
      if (onHighlightRoutes) {
        onHighlightRoutes([]);
      }
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

      // Highlight routes on map
      if (onHighlightRoutes) {
        const routeIds = result.routes
          .map(r => r.track_id ? parseInt(r.track_id) : null)
          .filter((id): id is number => id !== null);
        onHighlightRoutes(routeIds);
      }
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
      const result = await updateJourney(
        editingJourneyId,
        editName.trim(),
        editDescription.trim() || null,
        editDate
      );

      if (result.error) {
        showError(result.error);
      } else {
        showSuccess('Journey updated successfully');
        loadJourneys(); // Reload list
        // Trigger map refresh if journey date/routes changed
        if (onJourneyChanged) {
          onJourneyChanged();
        }
      }
    } catch (error) {
      console.error('Error updating journey:', error);
      showError('Failed to update journey');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    // Restore original values from the journey
    const journey = journeys.find(j => j.id === editingJourneyId);
    if (journey) {
      setEditName(journey.name);
      const dateStr = getUntimezonedDateStr(journey.date);
      setEditDate(dateStr);
      setEditDescription(journey.description || '');
      setEditTripId(journey.trip_id);
    }
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
          if (onHighlightRoutes) {
            onHighlightRoutes([]);
          }
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
                    </div>
                  )}

                  {/* Routes List */}
                  {viewedJourneyRoutes.length > 0 && (
                    <div>
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">
                        Routes in this journey:
                      </h5>
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {viewedJourneyRoutes.map((route) => (
                          <div
                            key={route.track_id}
                            className="p-2 bg-gray-50 border border-gray-200 rounded text-xs"
                          >
                            <div className="font-medium">
                              {route.track_number && `${route.track_number} `}
                              {route.from_station} ⟷ {route.to_station}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-gray-600">
                              <span>{Number(route.length_km)?.toFixed(1)} km</span>
                              {route.partial && (
                                <span className="text-orange-600 font-medium">Partial</span>
                              )}
                            </div>
                          </div>
                        ))}
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
      {!isLoading && filteredJourneys.length > 0 && (
        <div className="text-xs text-gray-600 text-center pt-2 border-t">
          Showing {filteredJourneys.length} of {journeys.length} journeys
        </div>
      )}
    </div>
  );
}
