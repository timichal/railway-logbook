'use client';

import { useState, useEffect } from 'react';
import { getAllRailwayRoutes, getRailwayRoute, updateRailwayRoute } from '@/lib/railway-actions';

interface RailwayRoute {
  track_id: string;
  name: string;
  description: string | null;
  usage_types: string[];
  primary_operator: string;
}

interface RouteDetail extends RailwayRoute {
  geometry: string;
}

interface AdminSidebarProps {
  selectedRouteId?: string | null;
  onRouteSelect?: (routeId: string) => void;
}

export default function AdminSidebar({ selectedRouteId, onRouteSelect }: AdminSidebarProps) {
  const [activeTab, setActiveTab] = useState<'routes' | 'create'>('routes');
  const [routes, setRoutes] = useState<RailwayRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<RouteDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editForm, setEditForm] = useState<{
    name: string;
    description: string;
    usage_types: string[];
    primary_operator: string;
  } | null>(null);

  // Load all routes on component mount
  useEffect(() => {
    loadRoutes();
  }, []);

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

  const handleRouteClick = async (trackId: string) => {
    try {
      setIsLoading(true);
      const routeDetail = await getRailwayRoute(trackId);
      setSelectedRoute(routeDetail);
      setEditForm({
        name: routeDetail.name,
        description: routeDetail.description || '',
        usage_types: routeDetail.usage_types,
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
  };

  const handleSaveRoute = async () => {
    if (!selectedRoute || !editForm) return;

    try {
      setIsLoading(true);
      await updateRailwayRoute(
        selectedRoute.track_id,
        editForm.name,
        editForm.description || null,
        editForm.usage_types,
        editForm.primary_operator
      );
      
      // Refresh the routes list
      await loadRoutes();
      
      // Update selected route
      setSelectedRoute({
        ...selectedRoute,
        ...editForm,
        description: editForm.description || null
      });
      
      console.log('Route updated successfully');
    } catch (error) {
      console.error('Error updating route:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUsageTypeChange = (index: number, value: string) => {
    if (!editForm) return;
    const newUsageTypes = [...editForm.usage_types];
    newUsageTypes[index] = value;
    setEditForm({ ...editForm, usage_types: newUsageTypes });
  };

  const addUsageType = () => {
    if (!editForm) return;
    setEditForm({ ...editForm, usage_types: [...editForm.usage_types, ''] });
  };

  const removeUsageType = (index: number) => {
    if (!editForm) return;
    const newUsageTypes = editForm.usage_types.filter((_, i) => i !== index);
    setEditForm({ ...editForm, usage_types: newUsageTypes });
  };

  return (
    <div className="w-96 bg-white border-r border-gray-200 flex flex-col">
      {/* Tab Headers */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('routes')}
          className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 ${
            activeTab === 'routes'
              ? 'border-blue-500 text-blue-600 bg-blue-50'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          Railway Routes
        </button>
        <button
          onClick={() => setActiveTab('create')}
          className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 ${
            activeTab === 'create'
              ? 'border-blue-500 text-blue-600 bg-blue-50'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          Create New
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'routes' && (
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
                      <div className="text-xs text-gray-500 mt-1 truncate">
                        ID: {route.track_id}
                      </div>
                      <div className="text-xs text-gray-500">
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
                  <div className="mb-4">
                    <h4 className="font-semibold text-gray-900 mb-2">Edit Route</h4>
                  </div>
                  
                  {editForm && (
                    <div className="space-y-4">
                      {/* Track ID (readonly) */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Track ID
                        </label>
                        <input
                          type="text"
                          value={selectedRoute.track_id}
                          readOnly
                          className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm text-black"
                        />
                      </div>

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

                      {/* Usage Types */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Usage Types
                        </label>
                        <div className="space-y-2">
                          {editForm.usage_types.map((usage, index) => (
                            <div key={index} className="flex gap-2">
                              <input
                                type="text"
                                value={usage}
                                onChange={(e) => handleUsageTypeChange(index, e.target.value)}
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                              />
                              <button
                                onClick={() => removeUsageType(index)}
                                className="px-2 py-2 text-red-600 hover:bg-red-50 rounded-md text-sm"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={addUsageType}
                            className="text-sm text-blue-600 hover:text-blue-800"
                          >
                            + Add Usage Type
                          </button>
                        </div>
                      </div>

                      {/* Save Button */}
                      <div className="pt-4 border-t border-gray-200">
                        <button
                          onClick={handleSaveRoute}
                          disabled={isLoading}
                          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md text-sm"
                        >
                          {isLoading ? 'Saving...' : 'Save Changes'}
                        </button>
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
        )}

        {activeTab === 'create' && (
          <div className="p-4">
            <h3 className="font-semibold text-gray-900 mb-4">Create New Route</h3>
            <div className="text-gray-500 text-sm">
              Coming soon - route creation functionality will be implemented here.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
