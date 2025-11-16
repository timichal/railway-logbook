'use client';

import { useState } from 'react';
import { updateMultipleRoutes } from '@/lib/userActions';
import { useToast } from '@/lib/toast';
import type { SelectedRoute } from '@/lib/types';
import JourneyPlanner from './JourneyPlanner';

interface RouteNode {
  track_id: number;
  from_station: string;
  to_station: string;
  description: string;
  length_km: number;
}

interface SelectedRoutesListProps {
  selectedRoutes: SelectedRoute[];
  onRemoveRoute: (trackId: string) => void;
  onManageTrips: (route: SelectedRoute) => void;
  onClearAll: () => void;
  onRefreshMap?: () => void;
  onUpdateRoutePartial: (trackId: string, partial: boolean) => void;
  onHighlightRoutes?: (routeIds: number[]) => void;
  onAddRoutesFromPlanner?: (routes: RouteNode[]) => void;
}

export default function SelectedRoutesList({
  selectedRoutes,
  onRemoveRoute,
  onManageTrips,
  onClearAll,
  onRefreshMap,
  onUpdateRoutePartial,
  onHighlightRoutes,
  onAddRoutesFromPlanner
}: SelectedRoutesListProps) {
  const { showSuccess, showError } = useToast();
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showJourneyPlanner, setShowJourneyPlanner] = useState(false);

  const handleLogAll = async () => {
    if (selectedRoutes.length === 0 || !date) return;

    setIsSaving(true);
    try {
      // Extract partial values for each route
      const partialValues = selectedRoutes.map(r => r.partial ?? false);

      await updateMultipleRoutes(
        selectedRoutes.map(r => parseInt(r.track_id)),
        date,
        note || null,
        partialValues
      );

      // Refresh map if callback provided
      if (onRefreshMap) {
        onRefreshMap();
      }

      // Clear the list and form
      onClearAll();
      setDate(today);
      setNote('');

      showSuccess('Routes logged successfully!');
    } catch (error) {
      console.error('Error saving routes:', error);
      showError('Failed to save routes');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="absolute top-4 left-4 w-96 bg-white rounded-lg shadow-xl p-4 z-10 max-h-[90vh] overflow-y-auto text-black">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold">Selected Routes</h3>
        {selectedRoutes.length > 0 && (
          <button
            onClick={onClearAll}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Clear all
          </button>
        )}
      </div>

      {selectedRoutes.length === 0 ? (
        <div className="text-sm text-gray-500 text-center py-8">
          Click routes on the map to add them here
        </div>
      ) : (
        <>
          {/* Routes List */}
          <div className="space-y-1 mb-4 max-h-64 overflow-y-auto">
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
                    onClick={() => onManageTrips(route)}
                    className="p-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded"
                    title="Manage trips"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => onRemoveRoute(route.track_id)}
                    className="text-gray-500 hover:text-gray-700 text-lg leading-none"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Bulk Log Form */}
          <div className="space-y-2 pt-3 border-t border-gray-200">
            <div>
              <label className="block text-sm font-medium mb-1">Date*</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Note</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Optional note for all routes..."
              />
            </div>

            <button
              onClick={handleLogAll}
              disabled={isSaving || !date}
              className={`w-full px-4 py-2 text-white rounded font-medium ${isSaving || !date
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700 cursor-pointer'
                }`}
            >
              {isSaving ? 'Saving...' : `Log All ${selectedRoutes.length} Routes`}
            </button>
          </div>
        </>
      )}

      {/* Journey Planner Section */}
      <div className="pt-3 border-t border-gray-200 mt-3">
        <button
          onClick={() => setShowJourneyPlanner(!showJourneyPlanner)}
          className="w-full px-3 py-2 bg-blue-50 text-blue-700 rounded font-medium text-sm hover:bg-blue-100 cursor-pointer flex items-center justify-between"
        >
          <span>{showJourneyPlanner ? 'Hide' : 'Show'} Journey Planner</span>
          <span className="text-lg">{showJourneyPlanner ? '−' : '+'}</span>
        </button>

        {showJourneyPlanner && (
          <div className="mt-3">
            <JourneyPlanner
              onHighlightRoutes={onHighlightRoutes}
              onAddRoutesToSelection={onAddRoutesFromPlanner}
            />
          </div>
        )}
      </div>
    </div>
  );
}
