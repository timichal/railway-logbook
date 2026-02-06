'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/lib/toast';
import type { SelectedRoute, Station } from '@/lib/types';
import { createJourney } from '@/lib/journeyActions';
import { getAllTrips } from '@/lib/tripActions';
import type { TripWithStats } from '@/lib/tripActions';
import JourneyPlanner from './JourneyPlanner';

interface RouteNode {
  track_id: number;
  from_station: string;
  to_station: string;
  description: string;
  length_km: number;
}

interface JourneyLoggerProps {
  selectedRoutes: SelectedRoute[];
  onRemoveRoute: (trackId: string) => void;
  onClearSelection: () => void;
  onUpdateRoutePartial: (trackId: string, partial: boolean) => void;
  onRoutesLogged: () => void;
  onHighlightRoutes?: (routeIds: number[]) => void;
  onAddRoutesFromPlanner?: (routes: RouteNode[]) => void;
  onStationClickHandler?: (handler: ((station: Station | null) => void) | null) => void;
}

export default function JourneyLogger({
  selectedRoutes,
  onRemoveRoute,
  onClearSelection,
  onUpdateRoutePartial,
  onRoutesLogged,
  onHighlightRoutes,
  onAddRoutesFromPlanner,
  onStationClickHandler
}: JourneyLoggerProps) {
  const { showSuccess, showError } = useToast();
  const today = new Date().toISOString().split('T')[0];

  // Journey form state
  const [journeyName, setJourneyName] = useState('');
  const [journeyDate, setJourneyDate] = useState(today);
  const [journeyDescription, setJourneyDescription] = useState('');
  const [journeyTripId, setJourneyTripId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Available trips for dropdown
  const [availableTrips, setAvailableTrips] = useState<TripWithStats[]>([]);

  useEffect(() => {
    getAllTrips().then(result => {
      if (!result.error) {
        setAvailableTrips(result.trips || []);
      }
    });
  }, []);

  const handleCreateJourney = async () => {
    if (!journeyName.trim() || !journeyDate || selectedRoutes.length === 0) {
      showError('Please fill in journey name, date, and select at least one route');
      return;
    }

    setIsSaving(true);
    try {
      const trackIds = selectedRoutes.map(r => parseInt(r.track_id));
      const partialFlags = selectedRoutes.map(r => r.partial ?? false);

      const result = await createJourney(
        journeyName.trim(),
        journeyDescription.trim() || null,
        journeyDate,
        trackIds,
        partialFlags,
        journeyTripId
      );

      if (result.error) {
        showError(result.error);
        return;
      }

      // Clear form and selection
      setJourneyName('');
      setJourneyDate(today);
      setJourneyDescription('');
      setJourneyTripId(null);
      onClearSelection();

      // Trigger map refresh
      onRoutesLogged();

      showSuccess(`Journey "${result.journey?.name}" created successfully!`);
    } catch (error) {
      console.error('Error creating journey:', error);
      showError(error instanceof Error ? error.message : 'Failed to create journey');
    } finally {
      setIsSaving(false);
    }
  };

  const totalDistance = selectedRoutes.reduce((sum, route) => sum + route.length_km, 0);

  return (
    <div className="p-4 text-black space-y-4">
      {/* Journey Form Section */}
      <div>
        <h3 className="text-lg font-bold mb-3">New Journey</h3>

        <div className="space-y-2">
          <div>
            <label className="block text-sm font-medium mb-1">Journey Name*</label>
            <input
              type="text"
              value={journeyName}
              onChange={(e) => setJourneyName(e.target.value)}
              placeholder="e.g., Prague to Vienna via Brno"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Date*</label>
            <input
              type="date"
              value={journeyDate}
              onChange={(e) => setJourneyDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={journeyDescription}
              onChange={(e) => setJourneyDescription(e.target.value)}
              rows={2}
              placeholder="Optional notes about this journey..."
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {availableTrips.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1">Trip</label>
              <select
                value={journeyTripId ?? ''}
                onChange={(e) => setJourneyTripId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">None</option>
                {availableTrips.map(trip => (
                  <option key={trip.id} value={trip.id}>{trip.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Journey Planner Section */}
      <div className="pt-3 border-t border-gray-200">
        <JourneyPlanner
          onHighlightRoutes={onHighlightRoutes}
          onAddRoutesToSelection={onAddRoutesFromPlanner}
          onStationClickHandler={onStationClickHandler}
        />
      </div>

      {/* Selected Routes Section */}
      <div className="pt-3 border-t border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">
            Selected Routes ({selectedRoutes.length})
          </h3>
          {selectedRoutes.length > 0 && (
            <button
              onClick={onClearSelection}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Clear all
            </button>
          )}
        </div>

        {selectedRoutes.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-8 bg-gray-50 rounded border border-gray-200">
            Click routes on the map to add them here
          </div>
        ) : (
          <>
            {/* Routes List */}
            <div className="space-y-1 mb-3 max-h-64 overflow-y-auto">
              {selectedRoutes.map((route) => (
                <div
                  key={route.track_id}
                  className="p-2 bg-gray-50 border border-gray-200 rounded text-xs flex items-start justify-between gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {route.track_number && `${route.track_number} `}
                      {route.from_station} ⟷ {route.to_station}
                    </div>
                    <div className="flex items-center gap-4 mt-1">
                      <span className="text-gray-600">{route.length_km.toFixed(1)} km</span>
                      <label className="flex items-center gap-1 cursor-pointer text-xs text-gray-700">
                        <input
                          type="checkbox"
                          checked={route.partial ?? false}
                          onChange={(e) => onUpdateRoutePartial(route.track_id, e.target.checked)}
                          className="w-3 h-3 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                        />
                        <span>Partial</span>
                      </label>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onRemoveRoute(route.track_id)}
                      className="text-gray-500 hover:text-gray-700 text-lg leading-none"
                      title="Remove route"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Summary */}
            <div className="text-xs text-gray-600 mb-3 flex justify-between items-center bg-blue-50 px-3 py-2 rounded border border-blue-200">
              <span className="font-medium">Total Distance:</span>
              <span className="font-bold text-blue-700">{totalDistance.toFixed(1)} km</span>
            </div>
          </>
        )}
      </div>

      {/* Submit Button */}
      <div className="pt-3 border-t border-gray-200">
        <button
          onClick={handleCreateJourney}
          disabled={isSaving || !journeyName.trim() || !journeyDate || selectedRoutes.length === 0}
          className={`w-full px-4 py-2 text-white rounded font-medium transition-colors ${
            isSaving || !journeyName.trim() || !journeyDate || selectedRoutes.length === 0
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700 cursor-pointer'
          }`}
          title={
            !journeyName.trim()
              ? 'Journey name is required'
              : !journeyDate
              ? 'Date is required'
              : selectedRoutes.length === 0
              ? 'Select at least one route'
              : ''
          }
        >
          {isSaving ? 'Creating...' : `Create Journey & Log ${selectedRoutes.length} Routes`}
        </button>
      </div>
    </div>
  );
}
