'use client';

import { useState, useEffect } from 'react';
import type { User } from '@/lib/authActions';
import type { DataAccess } from '@/lib/dataAccess';
import { useToast } from '@/lib/toast';
import type { SelectedRoute } from '@/lib/types';

interface RouteNode {
  track_id: number;
  from_station: string;
  to_station: string;
  description: string;
  length_km: number;
}

interface SelectedRoutesListProps {
  user: User | null;
  dataAccess: DataAccess;
  selectedRoutes: SelectedRoute[];
  onRemoveRoute: (trackId: string) => void;
  onManageTrips: (route: SelectedRoute) => void;
  onClearAll: () => void;
  onUpdateRoutePartial: (trackId: string, partial: boolean) => void;
  onHighlightRoutes?: (routeIds: number[]) => void;
  onAddRoutesFromPlanner?: (routes: RouteNode[]) => void;
  onRoutesLogged?: () => void;
}

export default function SelectedRoutesList({
  user,
  dataAccess,
  selectedRoutes,
  onRemoveRoute,
  onManageTrips,
  onClearAll,
  onUpdateRoutePartial,
  onHighlightRoutes,
  onAddRoutesFromPlanner,
  onRoutesLogged
}: SelectedRoutesListProps) {
  const { showSuccess, showError } = useToast();
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [tripCount, setTripCount] = useState(0);
  const [canAddMore, setCanAddMore] = useState(true);

  // Fetch trip count for unlogged users
  useEffect(() => {
    async function fetchTripCount() {
      if (!user) {
        const count = await dataAccess.getTripCount();
        const canAdd = await dataAccess.canAddMoreTrips();
        setTripCount(count);
        setCanAddMore(canAdd);
      }
    }
    fetchTripCount();
  }, [user, dataAccess]);

  const handleLogAll = async () => {
    if (selectedRoutes.length === 0 || !date) return;

    // Check if user can add more trips (for unlogged users)
    if (!user && !canAddMore) {
      showError('Trip limit reached (50/50). Please register to log more routes.');
      return;
    }

    setIsSaving(true);
    try {
      // Extract partial values for each route
      const partialValues = selectedRoutes.map(r => r.partial ?? false);

      await dataAccess.updateMultipleRoutes(
        selectedRoutes.map(r => parseInt(r.track_id)),
        date,
        note || null,
        partialValues
      );

      // Clear the list and form
      onClearAll();
      setDate(today);
      setNote('');

      // Refresh trip count for unlogged users
      if (!user) {
        const count = await dataAccess.getTripCount();
        const canAdd = await dataAccess.canAddMoreTrips();
        setTripCount(count);
        setCanAddMore(canAdd);
      }

      // Trigger map refresh callback
      if (onRoutesLogged) {
        onRoutesLogged();
      }

      showSuccess('Routes logged successfully!');
    } catch (error) {
      console.error('Error saving routes:', error);
      showError(error instanceof Error ? error.message : 'Failed to save routes');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 text-black">
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

      {/* Trip count and warning for unlogged users */}
      {!user && (
        <>
          <div className="mb-3 text-xs text-gray-600">
            {tripCount} / 50 trips stored locally
          </div>
          {tripCount >= 40 && (
            <div className={`mb-3 p-2 rounded text-xs ${tripCount >= 50 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-orange-50 text-orange-700 border border-orange-200'}`}>
              {tripCount >= 50
                ? 'Trip limit reached (50/50). Register to log unlimited trips and sync across devices.'
                : `You're using local storage (${tripCount}/50 trips). Register to save unlimited trips and sync across devices.`}
            </div>
          )}
        </>
      )}

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
              disabled={isSaving || !date || (!user && !canAddMore)}
              className={`w-full px-4 py-2 text-white rounded font-medium ${isSaving || !date || (!user && !canAddMore)
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700 cursor-pointer'
                }`}
              title={!user && !canAddMore ? 'Trip limit reached. Please register to log more routes.' : ''}
            >
              {isSaving ? 'Saving...' : `Log All ${selectedRoutes.length} Routes`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
