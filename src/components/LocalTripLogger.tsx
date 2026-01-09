'use client';

import { useState } from 'react';
import { useToast } from '@/lib/toast';
import type { SelectedRoute } from '@/lib/types';
import { LocalStorageManager } from '@/lib/localStorage';

interface LocalTripLoggerProps {
  selectedRoutes: SelectedRoute[];
  onRemoveRoute: (trackId: string) => void;
  onClearSelection: () => void;
  onUpdateRoutePartial: (trackId: string, partial: boolean) => void;
  onRoutesLogged: () => void;
}

export default function LocalTripLogger({
  selectedRoutes,
  onRemoveRoute,
  onClearSelection,
  onUpdateRoutePartial,
  onRoutesLogged
}: LocalTripLoggerProps) {
  const { showSuccess, showError } = useToast();
  const today = new Date().toISOString().split('T')[0];

  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const tripCount = LocalStorageManager.getTripCount();
  const canAddMore = LocalStorageManager.canAddMoreTrips();
  const remainingTrips = 50 - tripCount;

  const handleLogRoutes = async () => {
    if (!date || selectedRoutes.length === 0) {
      showError('Please select at least one route and set a date');
      return;
    }

    // Check if user can add these routes
    if (tripCount + selectedRoutes.length > 50) {
      showError(`Trip limit would be exceeded. You can only add ${remainingTrips} more routes. Please register to log unlimited routes.`);
      return;
    }

    setIsSaving(true);
    try {
      // Add each route as a separate trip
      for (const route of selectedRoutes) {
        LocalStorageManager.addTrip({
          track_id: route.track_id,
          date,
          note: note.trim() || null,
          partial: route.partial ?? false,
        });
      }

      // Clear form and selection
      setDate(today);
      setNote('');
      onClearSelection();

      // Trigger map refresh
      onRoutesLogged();

      showSuccess(`Logged ${selectedRoutes.length} route(s) successfully! (${tripCount + selectedRoutes.length}/50 trips used)`);
    } catch (error) {
      console.error('Error logging routes:', error);
      showError(error instanceof Error ? error.message : 'Failed to log routes');
    } finally {
      setIsSaving(false);
    }
  };

  const totalDistance = selectedRoutes.reduce((sum, route) => sum + route.length_km, 0);

  return (
    <div className="p-4 text-black space-y-4">
      {/* Storage Info */}
      <div className={`text-xs px-3 py-2 rounded border ${
        remainingTrips <= 10
          ? 'bg-orange-50 border-orange-200 text-orange-800'
          : 'bg-blue-50 border-blue-200 text-blue-700'
      }`}>
        <div className="font-medium mb-1">Local Storage ({tripCount}/50 trips)</div>
        <div className="text-xs">
          {remainingTrips > 0
            ? `${remainingTrips} trips remaining. Register for unlimited routes!`
            : 'Limit reached! Register to log more routes.'
          }
        </div>
      </div>

      {/* Logging Form Section */}
      <div>
        <h3 className="text-lg font-bold mb-3">Log Routes</h3>

        <div className="space-y-2">
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
            <label className="block text-sm font-medium mb-1">Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Optional notes..."
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>
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
          onClick={handleLogRoutes}
          disabled={isSaving || !date || selectedRoutes.length === 0 || !canAddMore}
          className={`w-full px-4 py-2 text-white rounded font-medium transition-colors ${
            isSaving || !date || selectedRoutes.length === 0 || !canAddMore
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700 cursor-pointer'
          }`}
          title={
            !canAddMore
              ? 'Trip limit reached (50/50). Please register to log more routes.'
              : !date
              ? 'Date is required'
              : selectedRoutes.length === 0
              ? 'Select at least one route'
              : ''
          }
        >
          {isSaving ? 'Saving...' : `Log ${selectedRoutes.length} Route(s)`}
        </button>
      </div>
    </div>
  );
}
