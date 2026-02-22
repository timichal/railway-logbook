'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/lib/toast';
import {
  getAllTrips,
  getTrip,
  createTrip,
  updateTrip,
  deleteTrip,
  assignJourneyToTrip,
  unassignJourneyFromTrip,
  getUnassignedJourneys,
} from '@/lib/tripActions';
import type { TripWithStats, JourneyInTrip } from '@/lib/tripActions';
import { getUntimezonedDateStr } from '@/lib/getUntimezonedDateStr';

interface TripsTabProps {
  onHighlightRoutes?: (routeIds: number[]) => void;
  onTripChanged?: () => void;
}

export default function TripsTab({
  onHighlightRoutes,
  onTripChanged,
}: TripsTabProps) {
  const { showSuccess, showError } = useToast();
  const [trips, setTrips] = useState<TripWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Create form state
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [isSavingNew, setIsSavingNew] = useState(false);

  // Expanded trip state
  const [expandedTripId, setExpandedTripId] = useState<number | null>(null);
  const [expandedJourneys, setExpandedJourneys] = useState<JourneyInTrip[]>([]);

  // Edit state
  const [editingTripId, setEditingTripId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // Journey picker state
  const [showPicker, setShowPicker] = useState(false);
  const [unassignedJourneys, setUnassignedJourneys] = useState<JourneyInTrip[]>([]);
  const [isLoadingUnassigned, setIsLoadingUnassigned] = useState(false);

  // Load trips on mount
  useEffect(() => {
    loadTrips();
  }, []);

  // Clear highlights when component unmounts
  useEffect(() => {
    return () => {
      if (onHighlightRoutes) {
        onHighlightRoutes([]);
      }
    };
  }, [onHighlightRoutes]);

  const loadTrips = async () => {
    setIsLoading(true);
    try {
      const result = await getAllTrips();
      if (result.error) {
        showError(result.error);
        setTrips([]);
      } else {
        setTrips(result.trips || []);
      }
    } catch (error) {
      console.error('Error loading trips:', error);
      showError('Failed to load trips');
      setTrips([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateTrip = async () => {
    if (!newName.trim()) {
      showError('Trip name is required');
      return;
    }

    setIsSavingNew(true);
    try {
      const result = await createTrip(newName.trim(), newDescription.trim() || null);
      if (result.error) {
        showError(result.error);
      } else {
        showSuccess(`Trip "${result.trip?.name}" created`);
        setNewName('');
        setNewDescription('');
        setIsCreating(false);
        loadTrips();
      }
    } catch (error) {
      console.error('Error creating trip:', error);
      showError('Failed to create trip');
    } finally {
      setIsSavingNew(false);
    }
  };

  const handleExpandTrip = async (tripId: number) => {
    if (expandedTripId === tripId) {
      setExpandedTripId(null);
      setExpandedJourneys([]);
      setEditingTripId(null);
      setShowPicker(false);
      if (onHighlightRoutes) {
        onHighlightRoutes([]);
      }
      return;
    }

    try {
      const result = await getTrip(tripId);
      if (result.error) {
        showError(result.error);
        return;
      }

      setExpandedTripId(tripId);
      setExpandedJourneys(result.journeys || []);
      setShowPicker(false);

      // Set up edit state
      if (result.trip) {
        setEditingTripId(tripId);
        setEditName(result.trip.name);
        setEditDescription(result.trip.description || '');
      }

      // Highlight all routes from all journeys in this trip
      if (onHighlightRoutes && result.routeIds) {
        onHighlightRoutes(result.routeIds);
      }
    } catch (error) {
      console.error('Error expanding trip:', error);
      showError('Failed to load trip details');
    }
  };

  const handleSaveEdit = async () => {
    if (!editingTripId) return;
    if (!editName.trim()) {
      showError('Trip name is required');
      return;
    }

    setIsSavingEdit(true);
    try {
      const result = await updateTrip(editingTripId, editName.trim(), editDescription.trim() || null);
      if (result.error) {
        showError(result.error);
      } else {
        showSuccess('Trip updated');
        loadTrips();
      }
    } catch (error) {
      console.error('Error updating trip:', error);
      showError('Failed to update trip');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleCancelEdit = () => {
    const trip = trips.find(t => t.id === editingTripId);
    if (trip) {
      setEditName(trip.name);
      setEditDescription(trip.description || '');
    }
  };

  const handleDeleteTrip = async (tripId: number) => {
    try {
      const result = await deleteTrip(tripId);
      if (result.error) {
        showError(result.error);
      } else {
        showSuccess('Trip deleted (journeys unassigned)');
        if (expandedTripId === tripId) {
          setExpandedTripId(null);
          setExpandedJourneys([]);
          if (onHighlightRoutes) {
            onHighlightRoutes([]);
          }
        }
        loadTrips();
        if (onTripChanged) onTripChanged();
      }
    } catch (error) {
      console.error('Error deleting trip:', error);
      showError('Failed to delete trip');
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleUnassignJourney = async (journeyId: number) => {
    try {
      const result = await unassignJourneyFromTrip(journeyId);
      if (result.error) {
        showError(result.error);
      } else {
        showSuccess('Journey unassigned from trip');
        // Refresh expanded trip and highlights
        if (expandedTripId) {
          const tripResult = await getTrip(expandedTripId);
          setExpandedJourneys(tripResult.journeys || []);
          if (onHighlightRoutes) {
            onHighlightRoutes(tripResult.routeIds || []);
          }
        }
        loadTrips();
        if (onTripChanged) onTripChanged();
      }
    } catch (error) {
      console.error('Error unassigning journey:', error);
      showError('Failed to unassign journey');
    }
  };

  const handleShowPicker = async () => {
    setShowPicker(true);
    setIsLoadingUnassigned(true);
    try {
      const result = await getUnassignedJourneys();
      if (result.error) {
        showError(result.error);
        setUnassignedJourneys([]);
      } else {
        setUnassignedJourneys(result.journeys || []);
      }
    } catch (error) {
      console.error('Error loading unassigned journeys:', error);
      showError('Failed to load unassigned journeys');
      setUnassignedJourneys([]);
    } finally {
      setIsLoadingUnassigned(false);
    }
  };

  const handleAssignJourney = async (journeyId: number) => {
    if (!expandedTripId) return;

    try {
      const result = await assignJourneyToTrip(journeyId, expandedTripId);
      if (result.error) {
        showError(result.error);
      } else {
        showSuccess('Journey added to trip');
        // Remove from unassigned list
        setUnassignedJourneys(prev => prev.filter(j => j.id !== journeyId));
        // Refresh expanded trip and highlights
        const tripResult = await getTrip(expandedTripId);
        setExpandedJourneys(tripResult.journeys || []);
        if (onHighlightRoutes) {
          onHighlightRoutes(tripResult.routeIds || []);
        }
        loadTrips();
        if (onTripChanged) onTripChanged();
      }
    } catch (error) {
      console.error('Error assigning journey:', error);
      showError('Failed to assign journey');
    }
  };

  const formatDateRange = (startDate: string | null, endDate: string | null): string => {
    if (!startDate) return 'No journeys';
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : start;

    const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    if (startDate === endDate) {
      return start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    // Same year? Don't repeat it
    if (start.getFullYear() === end.getFullYear()) {
      return `${startStr} - ${endStr}`;
    }

    const startFull = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${startFull} - ${endStr}`;
  };

  // Filter trips by search query
  const filteredTrips = trips.filter(trip => {
    const query = searchQuery.toLowerCase();
    return trip.name.toLowerCase().includes(query) ||
      (trip.description?.toLowerCase().includes(query) ?? false);
  });

  return (
    <div className="p-4 text-black space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">My Trips</h3>
          <p className="text-sm text-gray-600">Group journeys into trips</p>
        </div>
        {!isCreating && (
          <button
            onClick={() => setIsCreating(true)}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700"
          >
            New Trip
          </button>
        )}
      </div>

      {/* Create Form */}
      {isCreating && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded space-y-2">
          <h4 className="text-sm font-semibold">Create New Trip</h4>
          <div>
            <label className="block text-xs font-medium mb-1">Trip Name*</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g., Summer Holiday in Austria"
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isSavingNew}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Description</label>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={2}
              placeholder="Optional description..."
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              disabled={isSavingNew}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateTrip}
              disabled={isSavingNew || !newName.trim()}
              className={`flex-1 px-3 py-1.5 rounded text-sm font-medium ${
                isSavingNew || !newName.trim()
                  ? 'bg-gray-400 text-white cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {isSavingNew ? 'Creating...' : 'Create Trip'}
            </button>
            <button
              onClick={() => { setIsCreating(false); setNewName(''); setNewDescription(''); }}
              disabled={isSavingNew}
              className="flex-1 px-3 py-1.5 bg-gray-300 text-gray-700 rounded text-sm font-medium hover:bg-gray-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      {trips.length > 0 && (
        <div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search trips..."
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Trip List */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="text-center py-8 text-gray-500">Loading trips...</div>
        ) : filteredTrips.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {searchQuery
              ? 'No trips match your search'
              : 'No trips yet. Create your first trip to group journeys!'
            }
          </div>
        ) : (
          filteredTrips.map((trip) => (
            <div
              key={trip.id}
              className="p-3 bg-white border border-gray-300 rounded shadow-sm"
            >
              {/* Trip Header */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-base truncate">{trip.name}</h4>
                  {trip.description && (
                    <div className="text-xs text-gray-600 mt-1">{trip.description}</div>
                  )}
                </div>
              </div>

              {/* Trip Stats */}
              <div className="flex items-center gap-4 text-xs text-gray-700 mb-3 flex-wrap">
                <span className="font-medium">
                  {formatDateRange(trip.start_date, trip.end_date)}
                </span>
                <span>
                  <span className="font-medium">{trip.journey_count}</span> journeys
                </span>
                <span>
                  <span className="font-medium">{trip.route_count}</span> routes
                </span>
                <span>
                  <span className="font-medium">{Number(trip.total_distance).toFixed(1)}</span> km
                </span>
              </div>

              {/* Action Buttons */}
              {deleteConfirmId === trip.id ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDeleteTrip(trip.id)}
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
                    onClick={() => handleExpandTrip(trip.id)}
                    className={`flex-1 px-3 py-1.5 rounded text-sm font-medium ${
                      expandedTripId === trip.id
                        ? 'bg-amber-600 text-white hover:bg-amber-700'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {expandedTripId === trip.id ? 'Hide Details' : 'View / Edit'}
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(trip.id)}
                    className="px-3 py-1.5 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700"
                  >
                    Delete
                  </button>
                </div>
              )}

              {/* Expanded Trip Details */}
              {expandedTripId === trip.id && (
                <div className="mt-3 pt-3 border-t border-gray-200 space-y-3">
                  {/* Edit Form */}
                  {editingTripId === trip.id && (
                    <div className="space-y-2">
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">Edit Trip</h5>
                      <div>
                        <label className="block text-xs font-medium mb-1">Trip Name*</label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={isSavingEdit}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Description</label>
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={2}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                          disabled={isSavingEdit}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleSaveEdit}
                          disabled={isSavingEdit || !editName.trim()}
                          className={`flex-1 px-3 py-1.5 rounded text-xs font-medium ${
                            isSavingEdit || !editName.trim()
                              ? 'bg-gray-400 text-white cursor-not-allowed'
                              : 'bg-green-600 text-white hover:bg-green-700'
                          }`}
                        >
                          {isSavingEdit ? 'Saving...' : 'Save Changes'}
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          disabled={isSavingEdit}
                          className="flex-1 px-3 py-1.5 bg-gray-300 text-gray-700 rounded text-xs font-medium hover:bg-gray-400"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Assigned Journeys */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h5 className="text-sm font-semibold text-gray-700">
                        Journeys ({expandedJourneys.length})
                      </h5>
                      <button
                        onClick={handleShowPicker}
                        className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 font-medium"
                      >
                        Add Journeys
                      </button>
                    </div>

                    {expandedJourneys.length === 0 ? (
                      <div className="text-xs text-gray-500 text-center py-4 bg-gray-50 rounded border border-gray-200">
                        No journeys assigned yet
                      </div>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {expandedJourneys.map((journey) => (
                          <div
                            key={journey.id}
                            className="p-2 bg-gray-50 border border-gray-200 rounded text-xs flex items-center justify-between gap-2"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{journey.name}</div>
                              <div className="text-gray-600 flex items-center gap-3 mt-0.5">
                                <span>{new Date(journey.date).toLocaleDateString('cs-CZ')}</span>
                                <span>{journey.route_count} routes</span>
                                <span>{Number(journey.total_distance).toFixed(1)} km</span>
                              </div>
                            </div>
                            <button
                              onClick={() => handleUnassignJourney(journey.id)}
                              className="text-xs px-2 py-1 bg-gray-200 text-gray-600 rounded hover:bg-gray-300 font-medium flex-shrink-0"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Journey Picker */}
                  {showPicker && (
                    <div className="border border-blue-200 rounded bg-blue-50 p-2">
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="text-xs font-semibold text-blue-800">Unassigned Journeys</h5>
                        <button
                          onClick={() => setShowPicker(false)}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          Close
                        </button>
                      </div>
                      {isLoadingUnassigned ? (
                        <div className="text-xs text-gray-500 text-center py-3">Loading...</div>
                      ) : unassignedJourneys.length === 0 ? (
                        <div className="text-xs text-gray-500 text-center py-3">
                          All journeys are already assigned to trips
                        </div>
                      ) : (
                        <div className="space-y-1 max-h-36 overflow-y-auto">
                          {unassignedJourneys.map((journey) => (
                            <div
                              key={journey.id}
                              className="p-2 bg-white border border-gray-200 rounded text-xs flex items-center justify-between gap-2"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate">{journey.name}</div>
                                <div className="text-gray-600 flex items-center gap-3 mt-0.5">
                                  <span>{new Date(journey.date).toLocaleDateString('cs-CZ')}</span>
                                  <span>{Number(journey.total_distance).toFixed(1)} km</span>
                                </div>
                              </div>
                              <button
                                onClick={() => handleAssignJourney(journey.id)}
                                className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 font-medium flex-shrink-0"
                              >
                                Add
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Status Info */}
      {!isLoading && filteredTrips.length > 0 && (
        <div className="text-xs text-gray-600 text-center pt-2 border-t">
          Showing {filteredTrips.length} of {trips.length} trips
        </div>
      )}
    </div>
  );
}
