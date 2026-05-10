'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/lib/toast';
import {
  getTrip,
  updateTrip,
  deleteTrip,
  unassignJourneyFromTrip,
  assignJourneyToTrip,
  getUnassignedJourneys,
} from '@/lib/tripActions';
import type { TripWithStats, JourneyInTrip } from '@/lib/tripActions';
import type { SelectedRoute } from '@/lib/types';
import MergedJourneyCard from './MergedJourneyCard';

interface MergedTripCardProps {
  trip: TripWithStats;
  initialJourneys: JourneyInTrip[];
  availableTrips: TripWithStats[];
  // Parent enforces single-open across all top-level cards
  isOpen: boolean;
  onRequestOpen: () => void;
  onRequestClose: () => void;
  onChanged: () => void;
  onHighlightRoutes?: (routeIds: number[]) => void;
  // Forwarded to nested journey cards
  openNestedJourneyId: number | null;
  onNestedJourneyOpenChange: (journeyId: number | null) => void;
  onJourneyEditStart?: (handler: (route: SelectedRoute) => void) => void;
  onJourneyEditEnd?: () => void;
}

export default function MergedTripCard({
  trip,
  initialJourneys,
  availableTrips,
  isOpen,
  onRequestOpen,
  onRequestClose,
  onChanged,
  onHighlightRoutes,
  openNestedJourneyId,
  onNestedJourneyOpenChange,
  onJourneyEditStart,
  onJourneyEditEnd,
}: MergedTripCardProps) {
  const { showSuccess, showError } = useToast();

  const [journeys, setJourneys] = useState<JourneyInTrip[]>(initialJourneys);
  const [editName, setEditName] = useState(trip.name);
  const [editDescription, setEditDescription] = useState(trip.description || '');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const [showPicker, setShowPicker] = useState(false);
  const [unassignedJourneys, setUnassignedJourneys] = useState<JourneyInTrip[]>([]);
  const [isLoadingUnassigned, setIsLoadingUnassigned] = useState(false);

  // Sync from props when they change (after parent refreshes the list)
  useEffect(() => {
    setJourneys(initialJourneys);
  }, [initialJourneys]);

  useEffect(() => {
    setEditName(trip.name);
    setEditDescription(trip.description || '');
  }, [trip.name, trip.description]);

  // When a nested journey is being edited, the journey card owns highlights.
  // Otherwise, when the trip is open, highlight all routes in the trip.
  const refreshTripHighlights = useCallback(async () => {
    if (openNestedJourneyId !== null) return;
    if (!isOpen) return;
    const result = await getTrip(trip.id);
    if (!result.error) {
      setJourneys(result.journeys || []);
      onHighlightRoutes?.(result.routeIds || []);
    }
  }, [isOpen, openNestedJourneyId, trip.id, onHighlightRoutes]);

  useEffect(() => {
    if (!isOpen) return;
    if (openNestedJourneyId !== null) return;
    // (Re)highlight all trip routes whenever trip opens or nested journey closes
    refreshTripHighlights();
  }, [isOpen, openNestedJourneyId, refreshTripHighlights]);

  useEffect(() => {
    if (isOpen) return;
    setShowPicker(false);
    setDeleteConfirm(false);
  }, [isOpen]);

  const handleSaveEdit = async () => {
    if (!editName.trim()) {
      showError('Trip name is required');
      return;
    }
    setIsSavingEdit(true);
    try {
      const result = await updateTrip(trip.id, editName.trim(), editDescription.trim() || null);
      if (result.error) {
        showError(result.error);
      } else {
        showSuccess('Trip updated');
        onChanged();
      }
    } catch (error) {
      console.error('Error updating trip:', error);
      showError('Failed to update trip');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleCancelEdit = () => {
    setEditName(trip.name);
    setEditDescription(trip.description || '');
  };

  const handleDelete = async () => {
    try {
      const result = await deleteTrip(trip.id);
      if (result.error) {
        showError(result.error);
      } else {
        showSuccess('Trip deleted (journeys unassigned)');
        onRequestClose();
        onChanged();
      }
    } catch (error) {
      console.error('Error deleting trip:', error);
      showError('Failed to delete trip');
    } finally {
      setDeleteConfirm(false);
    }
  };

  const handleUnassignJourney = async (journeyId: number) => {
    try {
      const result = await unassignJourneyFromTrip(journeyId);
      if (result.error) {
        showError(result.error);
      } else {
        showSuccess('Journey unassigned from trip');
        await refreshTripHighlights();
        onChanged();
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
    try {
      const result = await assignJourneyToTrip(journeyId, trip.id);
      if (result.error) {
        showError(result.error);
      } else {
        showSuccess('Journey added to trip');
        setUnassignedJourneys(prev => prev.filter(j => j.id !== journeyId));
        await refreshTripHighlights();
        onChanged();
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
    if (start.getFullYear() === end.getFullYear()) {
      return `${startStr} - ${endStr}`;
    }
    const startFull = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${startFull} - ${endStr}`;
  };

  return (
    <div className="p-3 bg-white border border-purple-300 rounded shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-800 flex-shrink-0 uppercase tracking-wide">
              Trip
            </span>
            <h4 className="font-bold text-base truncate">{trip.name}</h4>
          </div>
          {trip.description && (
            <div className="text-xs text-gray-600 mt-1">{trip.description}</div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-700 mb-3 flex-wrap">
        <span className="font-medium">{formatDateRange(trip.start_date, trip.end_date)}</span>
        <span><span className="font-medium">{trip.journey_count}</span> journeys</span>
        <span><span className="font-medium">{trip.route_count}</span> routes</span>
        <span><span className="font-medium">{Number(trip.total_distance).toFixed(1)}</span> km</span>
      </div>

      {deleteConfirm ? (
        <div className="flex items-center gap-2">
          <button
            onClick={handleDelete}
            className="flex-1 px-3 py-1.5 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700"
          >
            Confirm Delete
          </button>
          <button
            onClick={() => setDeleteConfirm(false)}
            className="flex-1 px-3 py-1.5 bg-gray-300 text-gray-700 rounded text-sm font-medium hover:bg-gray-400"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={isOpen ? onRequestClose : onRequestOpen}
            className={`flex-1 px-3 py-1.5 rounded text-sm font-medium ${
              isOpen ? 'bg-amber-600 text-white hover:bg-amber-700' : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {isOpen ? 'Hide Details' : 'View / Edit'}
          </button>
          <button
            onClick={() => setDeleteConfirm(true)}
            className="px-3 py-1.5 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      )}

      {isOpen && (
        <div className="mt-3 pt-3 border-t border-gray-200 space-y-3">
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
                Reset
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h5 className="text-sm font-semibold text-gray-700">
                Journeys ({journeys.length})
              </h5>
              <button
                onClick={handleShowPicker}
                className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 font-medium"
              >
                Add Journeys
              </button>
            </div>

            {journeys.length === 0 ? (
              <div className="text-xs text-gray-500 text-center py-4 bg-gray-50 rounded border border-gray-200">
                No journeys assigned yet
              </div>
            ) : (
              <div className="space-y-2">
                {journeys.map((journey) => (
                  <div key={journey.id} className="relative">
                    <MergedJourneyCard
                      journey={journey}
                      availableTrips={availableTrips}
                      isOpen={openNestedJourneyId === journey.id}
                      onRequestOpen={() => onNestedJourneyOpenChange(journey.id)}
                      onRequestClose={() => onNestedJourneyOpenChange(null)}
                      onChanged={onChanged}
                      onHighlightRoutes={onHighlightRoutes}
                      onJourneyEditStart={onJourneyEditStart}
                      onJourneyEditEnd={onJourneyEditEnd}
                      nested
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

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
                  {unassignedJourneys.map((j) => (
                    <div
                      key={j.id}
                      className="p-2 bg-white border border-gray-200 rounded text-xs flex items-center justify-between gap-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{j.name}</div>
                        <div className="text-gray-600 flex items-center gap-3 mt-0.5">
                          <span>{new Date(j.date).toLocaleDateString('cs-CZ')}</span>
                          <span>{Number(j.total_distance).toFixed(1)} km</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleAssignJourney(j.id)}
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
  );
}
