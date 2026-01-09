'use client';

import { useState } from 'react';
import { useToast } from '@/lib/toast';
import type { SelectedRoute, Station } from '@/lib/types';
import { LocalStorageManager } from '@/lib/localStorage';
import JourneyPlanner from './JourneyPlanner';

interface RouteNode {
  track_id: number;
  from_station: string;
  to_station: string;
  description: string;
  length_km: number;
}

interface LocalTripLoggerProps {
  selectedRoutes: SelectedRoute[];
  onRemoveRoute: (trackId: string) => void;
  onClearSelection: () => void;
  onUpdateRoutePartial: (trackId: string, partial: boolean) => void;
  onRoutesLogged: () => void;
  onHighlightRoutes?: (routeIds: number[]) => void;
  onAddRoutesFromPlanner?: (routes: RouteNode[]) => void;
  onStationClickHandler?: (handler: ((station: Station | null) => void) | null) => void;
}

export default function LocalTripLogger({
  selectedRoutes,
  onRemoveRoute,
  onClearSelection,
  onUpdateRoutePartial,
  onRoutesLogged,
  onHighlightRoutes,
  onAddRoutesFromPlanner,
  onStationClickHandler
}: LocalTripLoggerProps) {
  const { showSuccess, showError } = useToast();
  const today = new Date().toISOString().split('T')[0];

  // Journey form state
  const [journeyName, setJourneyName] = useState('');
  const [journeyDate, setJourneyDate] = useState(today);
  const [journeyDescription, setJourneyDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const journeyCount = LocalStorageManager.getJourneyCount();
  const canAddMore = LocalStorageManager.canAddMoreJourneys();
  const remainingJourneys = 5 - journeyCount;

  const handleCreateJourney = async () => {
    if (!journeyName.trim() || !journeyDate || selectedRoutes.length === 0) {
      showError('Please fill in journey name, date, and select at least one route');
      return;
    }

    setIsSaving(true);
    try {
      // Create journey
      const newJourney = LocalStorageManager.addJourney({
        name: journeyName.trim(),
        description: journeyDescription.trim() || null,
        date: journeyDate,
      });

      // Add logged parts
      const parts = selectedRoutes.map(r => ({
        journey_id: newJourney.id,
        track_id: parseInt(r.track_id),
        partial: r.partial ?? false,
      }));

      LocalStorageManager.addLoggedParts(parts);

      // Clear form and selection
      setJourneyName('');
      setJourneyDate(today);
      setJourneyDescription('');
      onClearSelection();

      // Trigger map refresh
      onRoutesLogged();

      showSuccess(`Journey "${newJourney.name}" created successfully! (${journeyCount + 1}/5 journeys used)`);
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
      {/* Storage Info */}
      <div className={`text-xs px-3 py-2 rounded border ${
        remainingJourneys <= 2
          ? 'bg-orange-50 border-orange-200 text-orange-800'
          : 'bg-blue-50 border-blue-200 text-blue-700'
      }`}>
        <div className="font-medium mb-1">Local Storage ({journeyCount}/5 journeys)</div>
        <div className="text-xs">
          {remainingJourneys > 0
            ? `${remainingJourneys} journey${remainingJourneys === 1 ? '' : 's'} remaining. Register for unlimited journeys!`
            : 'Limit reached! Register to log more journeys.'
          }
        </div>
      </div>

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
          disabled={isSaving || !journeyName.trim() || !journeyDate || selectedRoutes.length === 0 || !canAddMore}
          className={`w-full px-4 py-2 text-white rounded font-medium transition-colors ${
            isSaving || !journeyName.trim() || !journeyDate || selectedRoutes.length === 0 || !canAddMore
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700 cursor-pointer'
          }`}
          title={
            !canAddMore
              ? 'Journey limit reached (5/5). Please register to log more journeys.'
              : !journeyName.trim()
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
