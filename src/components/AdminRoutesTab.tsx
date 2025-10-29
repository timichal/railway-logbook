'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { getAllRailwayRoutes, getRailwayRoute, updateRailwayRoute } from '@/lib/railway-actions';
import { deleteRailwayRoute } from '@/lib/route-delete-actions';
import { usageOptions } from '@/lib/constants';

interface RailwayRoute {
  track_id: string;
  from_station: string;
  to_station: string;
  track_number?: string | null;
  description: string | null;
  usage_type: string;
  starting_part_id?: string | null;
  ending_part_id?: string | null;
  is_valid?: boolean;
  error_message?: string | null;
}

interface RouteDetail extends RailwayRoute {
  geometry: string;
  length_km?: number;
}

interface AdminRoutesTabProps {
  selectedRouteId?: string | null;
  onRouteSelect?: (routeId: string) => void;
  onRouteDeleted?: () => void;
  onRouteUpdated?: () => void;
  onEditGeometry?: (trackId: string) => void;
}

export default function AdminRoutesTab({ selectedRouteId, onRouteSelect, onRouteDeleted, onRouteUpdated, onEditGeometry }: AdminRoutesTabProps) {
  const [routes, setRoutes] = useState<RailwayRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<RouteDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editForm, setEditForm] = useState<{
    from_station: string;
    to_station: string;
    track_number: string;
    description: string;
    usage_type: string;
  } | null>(null);

  const loadRoutes = async () => {
    try {
      setIsLoading(true);
      const routesData = await getAllRailwayRoutes();
      setRoutes(routesData);
    } catch (error) {
      console.error('Error loading routes:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRouteClick = useCallback(async (trackId: string) => {
    try {
      setIsLoading(true);
      const routeDetail = await getRailwayRoute(trackId);
      setSelectedRoute(routeDetail);
      setEditForm({
        from_station: routeDetail.from_station,
        to_station: routeDetail.to_station,
        track_number: routeDetail.track_number || '',
        description: routeDetail.description || '',
        usage_type: routeDetail.usage_type
      });

      // Notify parent component about route selection
      if (onRouteSelect) {
        onRouteSelect(trackId);
      }
    } catch (error) {
      console.error('Error loading route detail:', error);
    } finally {
      setIsLoading(false);
    }
  }, [onRouteSelect]);

  // Load all routes on component mount
  useEffect(() => {
    loadRoutes();
  }, []);

  // Load route details when selectedRouteId changes (from map click)
  useEffect(() => {
    if (selectedRouteId && selectedRouteId !== selectedRoute?.track_id) {
      handleRouteClick(selectedRouteId);
    } else if (!selectedRouteId) {
      // Clear selection when selectedRouteId is null (clicked outside)
      setSelectedRoute(null);
      setEditForm(null);
    }
  }, [selectedRouteId, selectedRoute?.track_id, handleRouteClick]);

  const handleSaveRoute = async () => {
    if (!selectedRoute || !editForm) return;

    try {
      setIsLoading(true);
      await updateRailwayRoute(
        selectedRoute.track_id,
        editForm.from_station,
        editForm.to_station,
        editForm.track_number || null,
        editForm.description || null,
        editForm.usage_type
      );

      // Refresh the routes list
      await loadRoutes();

      // Update selected route with new data
      setSelectedRoute({
        ...selectedRoute,
        ...editForm,
        track_number: editForm.track_number || null,
        description: editForm.description || null
      });

      // Notify parent to refresh map tiles
      if (onRouteUpdated) {
        onRouteUpdated();
      }

      console.log('Route updated successfully');
    } catch (error) {
      console.error('Error updating route:', error);
    } finally {
      setIsLoading(false);
    }
  };


  const handleDeleteRoute = async () => {
    if (!selectedRoute) return;

    const confirmDelete = confirm(
      `Are you sure you want to delete the route "${selectedRoute.from_station} ⟷ ${selectedRoute.to_station}"?\n\n` +
      `Track ID: ${selectedRoute.track_id}\n` +
      `This action cannot be undone.`
    );

    if (!confirmDelete) return;

    try {
      setIsLoading(true);
      await deleteRailwayRoute(selectedRoute.track_id);

      console.log('Route deleted successfully');

      // Refresh the routes list
      await loadRoutes();

      // Clear the selected route
      setSelectedRoute(null);
      setEditForm(null);

      // Clear parent's selected route ID to prevent "Route not found" error
      if (onRouteSelect) {
        onRouteSelect('');
      }

      // Notify parent to refresh map layer
      if (onRouteDeleted) {
        onRouteDeleted();
      }

      alert(`Route "${selectedRoute.from_station} ⟷ ${selectedRoute.to_station}" has been deleted successfully.`);

    } catch (error) {
      console.error('Error deleting route:', error);
      alert(`Error deleting route: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full flex">
      {/* Routes List */}
      <div className="w-1/2 border-r border-gray-200 overflow-y-auto">
        <div className="p-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Routes ({routes.length})</h3>
        </div>
        {isLoading && !selectedRoute ? (
          <div className="p-4 text-center text-gray-500">Loading...</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {routes.map((route) => (
              <button
                key={route.track_id}
                onClick={() => handleRouteClick(route.track_id)}
                className={`w-full p-3 text-left hover:bg-gray-50 focus:bg-blue-50 focus:outline-none ${selectedRouteId === route.track_id ? 'bg-blue-50' : ''
                  }`}
              >
                <div className="font-medium text-sm text-gray-900 truncate">
                  {route.from_station} ⟷ {route.to_station}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Route Detail */}
      <div className="w-1/2 overflow-y-auto">
        {selectedRoute ? (
          <div className="p-4">
            <div className="mb-4 flex justify-between items-center">
              <h4 className="font-semibold text-gray-900">Edit Route</h4>
              <button
                onClick={() => {
                  setSelectedRoute(null);
                  setEditForm(null);
                  if (onRouteSelect) {
                    onRouteSelect('');
                  }
                }}
                className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md border border-gray-300"
              >
                Unselect
              </button>
            </div>

            {editForm && (
              <div className="space-y-4">
                {/* Invalid Route Alert */}
                {selectedRoute.is_valid === false && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-3">
                    <div className="flex items-start">
                      <div className="flex-shrink-0">
                        <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-red-800">
                          Invalid Route
                        </h3>
                        {selectedRoute.error_message && (
                          <div className="mt-2 text-sm text-red-700">
                            <p className="mt-1 font-mono text-xs">{selectedRoute.error_message}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Track Number */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Local route number(s)
                  </label>
                  <input
                    type="text"
                    value={editForm.track_number}
                    onChange={(e) => setEditForm({ ...editForm, track_number: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                    placeholder="e.g., 310, 102"
                  />
                </div>

                {/* From Station */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    From *
                  </label>
                  <input
                    type="text"
                    value={editForm.from_station}
                    onChange={(e) => setEditForm({ ...editForm, from_station: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                  />
                </div>

                {/* To Station */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    To *
                  </label>
                  <input
                    type="text"
                    value={editForm.to_station}
                    onChange={(e) => setEditForm({ ...editForm, to_station: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                  />
                </div>

                {/* Usage Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Usage Type *
                  </label>
                  <select
                    value={editForm.usage_type}
                    onChange={(e) => setEditForm({ ...editForm, usage_type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black bg-white"
                  >
                    <option value="">Select usage type</option>
                    {usageOptions.map((option) => (
                      <option key={option.key} value={option.id.toString()}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Save and Delete Buttons */}
                <div className="pt-4 border-t border-gray-200 space-y-2">
                  <button
                    onClick={handleSaveRoute}
                    disabled={isLoading}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer"
                  >
                    {isLoading ? 'Saving...' : 'Save Metadata'}
                  </button>

                  <button
                    onClick={() => onEditGeometry && onEditGeometry(selectedRoute.track_id)}
                    disabled={isLoading}
                    className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer"
                  >
                    Edit Route Geometry
                  </button>

                  <button
                    onClick={handleDeleteRoute}
                    disabled={isLoading}
                    className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer"
                  >
                    {isLoading ? 'Deleting...' : 'Delete Route'}
                  </button>

                  <p className="text-xs text-gray-500 text-center">
                    Deletion is permanent and cannot be undone
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 text-center text-gray-500">
            Select a route to edit
          </div>
        )}
      </div>
    </div>
  );
}
