'use client';

import React, { useState } from 'react';
import { getAllUsageOptions } from '@/lib/constants';
import { findRailwayPathDB } from '@/lib/db-path-actions';
import { getRailwayPartsByIds } from '@/lib/railway-parts-actions';
import type { RailwayPart } from '@/lib/types';

interface AdminCreateRouteTabProps {
  startingId: string;
  endingId: string;
  onStartingIdChange: (id: string) => void;
  onEndingIdChange: (id: string) => void;
  onPreviewRoute?: (partIds: string[], coordinates: [number, number][], railwayParts: RailwayPart[]) => void;
  isPreviewMode?: boolean;
  onCancelPreview?: () => void;
  onSaveRoute?: (routeData: {track_id: string, name: string, description: string, usage_types: string[], primary_operator: string}) => void;
  onFormReset?: () => void;
}

export default function AdminCreateRouteTab({ startingId, endingId, onStartingIdChange, onEndingIdChange, onPreviewRoute, isPreviewMode, onCancelPreview, onSaveRoute, onFormReset }: AdminCreateRouteTabProps) {
  
  // Create route form state (without the IDs that are managed by parent)
  const [createForm, setCreateForm] = useState({
    track_id: '',
    name: '',
    description: '',
    usage_types: [''] as string[],
    primary_operator: ''
  });

  // Reset form function
  const resetForm = () => {
    setCreateForm({
      track_id: '',
      name: '',
      description: '',
      usage_types: [''],
      primary_operator: ''
    });
    // Clear the IDs managed by parent via callback
    if (onFormReset) {
      onFormReset();
    }
  };

  // Clear starting ID
  const clearStartingId = () => {
    onStartingIdChange('');
  };

  // Clear ending ID
  const clearEndingId = () => {
    onEndingIdChange('');
  };

  // Handle create form usage types
  const handleCreateUsageTypeChange = (index: number, value: string) => {
    const newUsageTypes = [...createForm.usage_types];
    newUsageTypes[index] = value;
    setCreateForm({ ...createForm, usage_types: newUsageTypes });
  };

  const addCreateUsageType = () => {
    setCreateForm({ ...createForm, usage_types: [...createForm.usage_types, ''] });
  };

  const removeCreateUsageType = (index: number) => {
    const newUsageTypes = createForm.usage_types.filter((_, i) => i !== index);
    setCreateForm({ ...createForm, usage_types: newUsageTypes });
  };

  // Handle preview route functionality
  const handlePreviewRoute = async () => {
    if (!startingId || !endingId || !onPreviewRoute) {
      console.error('Preview: Missing starting ID, ending ID, or preview callback');
      return;
    }

    console.log('Preview: Finding path from', startingId, 'to', endingId);

    // Use database-based server action to find path
    const result = await findRailwayPathDB(startingId, endingId);

    if (result) {
      console.log('Preview: Path found!');
      console.log('Part IDs:', result.partIds);

      // Fetch the actual railway part geometries from the database
      const railwayParts = await getRailwayPartsByIds(result.partIds);
      console.log('Preview: Fetched', railwayParts.length, 'railway part geometries');

      // Pass both the path result and the individual railway parts
      onPreviewRoute(result.partIds, result.coordinates, railwayParts);
    } else {
      console.error('Preview: No path found between', startingId, 'and', endingId);
      alert('No path found between the selected railway parts within 50km. Make sure both parts are connected through the railway network.');
    }
  };

  // Handle save route functionality
  const handleSaveRoute = async () => {
    if (!onSaveRoute) return;

    await onSaveRoute({
      track_id: createForm.track_id,
      name: createForm.name,
      description: createForm.description,
      usage_types: createForm.usage_types.filter(usage => usage !== ''), // Remove empty usage types
      primary_operator: createForm.primary_operator
    });

    // Reset form after successful save
    resetForm();
  };

  return (
    <div className="p-4 overflow-y-auto">
      <h3 className="font-semibold text-gray-900 mb-4">Create New Route</h3>
      <p className="text-sm text-gray-600 mb-4">
        Click on railway parts in the map to set starting and ending points.
      </p>
      
      <div className="space-y-4">
        {/* Starting ID */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Starting Part ID *
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={startingId || ''}
              onChange={(e) => onStartingIdChange(e.target.value)}
              placeholder="Click a railway part on the map"
              disabled={isPreviewMode}
              className={`flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black ${
                isPreviewMode ? 'bg-gray-100 cursor-not-allowed' : ''
              }`}
            />
            <button
              onClick={clearStartingId}
              disabled={isPreviewMode}
              className={`px-2 py-2 text-red-600 hover:bg-red-50 rounded-md text-sm border border-gray-300 ${
                isPreviewMode ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              title="Clear starting ID"
            >
              ×
            </button>
          </div>
        </div>

        {/* Ending ID */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Ending Part ID *
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={endingId || ''}
              onChange={(e) => onEndingIdChange(e.target.value)}
              placeholder="Click a railway part on the map"
              disabled={isPreviewMode}
              className={`flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black ${
                isPreviewMode ? 'bg-gray-100 cursor-not-allowed' : ''
              }`}
            />
            <button
              onClick={clearEndingId}
              disabled={isPreviewMode}
              className={`px-2 py-2 text-red-600 hover:bg-red-50 rounded-md text-sm border border-gray-300 ${
                isPreviewMode ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              title="Clear ending ID"
            >
              ×
            </button>
          </div>
        </div>

        {/* Track ID */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Track ID *
          </label>
          <input
            type="text"
            value={createForm.track_id}
            onChange={(e) => setCreateForm({ ...createForm, track_id: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
            placeholder="e.g., cz010a, at120"
          />
          <p className="text-xs text-gray-500 mt-1">
            Unique identifier for the railway line (manually assigned)
          </p>
        </div>

        {/* Route Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Route Name *
          </label>
          <input
            type="text"
            value={createForm.name}
            onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
            placeholder="Enter route name"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            value={createForm.description}
            onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
            placeholder="Enter route description"
          />
        </div>

        {/* Primary Operator */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Primary Operator *
          </label>
          <input
            type="text"
            value={createForm.primary_operator}
            onChange={(e) => setCreateForm({ ...createForm, primary_operator: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
            placeholder="e.g., ČD, ÖBB"
          />
        </div>

        {/* Usage Types */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Usage Types
          </label>
          <div className="space-y-2">
            {createForm.usage_types.map((usage, index) => {
              const usageOptions = getAllUsageOptions();
              return (
                <div key={index} className="flex gap-2">
                  <select
                    value={usage}
                    onChange={(e) => handleCreateUsageTypeChange(index, e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black bg-white"
                  >
                    <option value="">Select usage type</option>
                    {usageOptions.map((option) => (
                      <option key={option.key} value={option.id.toString()}>
                        {option.label} - {option.description}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => removeCreateUsageType(index)}
                    className="px-2 py-2 text-red-600 hover:bg-red-50 rounded-md text-sm"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button
              onClick={addCreateUsageType}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              + Add Usage Type
            </button>
          </div>
        </div>

        {/* Preview/Cancel/Save Buttons */}
        <div className="pt-4 border-t border-gray-200">
          {!isPreviewMode ? (
            <>
              <button
                onClick={handlePreviewRoute}
                disabled={!startingId || !endingId}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md text-sm"
              >
                Preview Route
              </button>
              <p className="text-xs text-gray-500 mt-2">
                Click to find and preview the route between the selected railway parts
              </p>
            </>
          ) : (
            <>
              <div className="mb-4 p-3 bg-orange-100 border border-orange-300 rounded-md">
                <h4 className="font-medium text-orange-800 mb-1">🔍 Route Preview Active</h4>
                <p className="text-sm text-orange-700">
                  The route is displayed on the map as an orange dashed line. 
                  Railway parts layer is hidden for better visibility.
                </p>
              </div>
              
              <div className="space-y-2">
                <button
                  onClick={onCancelPreview}
                  className="w-full bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 px-4 rounded-md text-sm"
                >
                  Cancel Preview
                </button>
                
                <button
                  onClick={handleSaveRoute}
                  disabled={!createForm.track_id || !createForm.name || !createForm.primary_operator}
                  className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md text-sm"
                >
                  Save Route to Database
                </button>
                
                <p className="text-xs text-gray-500">
                  Save will create a new railway route with the previewed path and form data.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
