'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { getAllRailwayRoutes, getRailwayRoute, updateRailwayRoute } from '@/lib/railway-actions';
import { deleteRailwayRoute } from '@/lib/route-delete-actions';
import { getAllUsageOptions } from '@/lib/constants';

interface RailwayRoute {
  track_id: string;
  name: string;
  description: string | null;
  usage_type: string;
  primary_operator: string;
}

interface RouteDetail extends RailwayRoute {
  geometry: string;
}

interface AdminRoutesTabProps {
  selectedRouteId?: string | null;
  onRouteSelect?: (routeId: string) => void;
  onRouteDeleted?: () => void;
  onRouteUpdated?: () => void;
}

export default function AdminRoutesTab({ selectedRouteId, onRouteSelect, onRouteDeleted, onRouteUpdated }: AdminRoutesTabProps) {
  const [routes, setRoutes] = useState<RailwayRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<RouteDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editForm, setEditForm] = useState<{
    name: string;
    description: string;
    usage_type: string;
    primary_operator: string;
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
        name: routeDetail.name,
        description: routeDetail.description || '',
        usage_type: routeDetail.usage_type,
        primary_operator: routeDetail.primary_operator
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
    }
  }, [selectedRouteId, selectedRoute?.track_id, handleRouteClick]);

  const handleSaveRoute = async () => {
    if (!selectedRoute || !editForm) return;

    try {
      setIsLoading(true);
      await updateRailwayRoute(
        selectedRoute.track_id,
        editForm.name,
        editForm.description || null,
        editForm.usage_type,
        editForm.primary_operator
      );

      // Refresh the routes list
      await loadRoutes();

      // Update selected route with new data
      setSelectedRoute({
        ...selectedRoute,
        ...editForm,
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
      `Are you sure you want to delete the route "${selectedRoute.name}"?\n\n` +
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

      alert(`Route "${selectedRoute.name}" has been deleted successfully.`);
      
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
                className={`w-full p-3 text-left hover:bg-gray-50 focus:bg-blue-50 focus:outline-none ${
                  selectedRouteId === route.track_id ? 'bg-blue-50' : ''
                }`}
              >
                <div className="font-medium text-sm text-gray-900 truncate">
                  {route.name}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {route.primary_operator}
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
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
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

                {/* Primary Operator */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Primary Operator *
                  </label>
                  <input
                    type="text"
                    value={editForm.primary_operator}
                    onChange={(e) => setEditForm({ ...editForm, primary_operator: e.target.value })}
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
                    {getAllUsageOptions().map((option) => (
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
                    {isLoading ? 'Saving...' : 'Save Changes'}
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
