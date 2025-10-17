'use client';

import React, { useState, useEffect } from 'react';
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
  onSaveRoute?: (routeData: { name: string, description: string, usage_type: string }) => void;
  onFormReset?: () => void;
}

export default function AdminCreateRouteTab({ startingId, endingId, onStartingIdChange, onEndingIdChange, onPreviewRoute, isPreviewMode, onCancelPreview, onSaveRoute, onFormReset }: AdminCreateRouteTabProps) {

  // Create route form state (without the IDs that are managed by parent)
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    usage_type: ''
  });

  // Reset form function
  const resetForm = () => {
    setCreateForm({
      name: '',
      description: '',
      usage_type: ''
    });
    // Clear the IDs managed by parent via callback
    if (onFormReset) {
      onFormReset();
    }
  };

  // Clear starting ID
  const clearStartingId = () => {
    onStartingIdChange('');
    if (onCancelPreview) {
      onCancelPreview();
    }
  };

  // Clear ending ID
  const clearEndingId = () => {
    onEndingIdChange('');
    if (onCancelPreview) {
      onCancelPreview();
    }
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
      name: createForm.name,
      description: createForm.description,
      usage_type: createForm.usage_type
    });

    // Reset form after successful save
    resetForm();
  };

  // Automatically preview route when both IDs are filled
  useEffect(() => {
    if (startingId && endingId && !isPreviewMode) {
      handlePreviewRoute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startingId, endingId, isPreviewMode]);

  return (
    <div className="p-4 overflow-y-auto">
      <h3 className="font-semibold text-gray-900 mb-4">Create New Route</h3>
      <p className="text-sm text-gray-600 mb-4">
        Click on railway parts in the map to set starting and ending points. The route will be automatically previewed on the map.
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
              className={`flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black ${isPreviewMode ? 'bg-gray-100 cursor-not-allowed' : ''
                }`}
            />
            <button
              onClick={clearStartingId}
              className="px-2 py-2 text-red-600 hover:bg-red-50 rounded-md text-sm border border-gray-300"
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
              className={`flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black ${isPreviewMode ? 'bg-gray-100 cursor-not-allowed' : ''
                }`}
            />
            <button
              onClick={clearEndingId}
              className="px-2 py-2 text-red-600 hover:bg-red-50 rounded-md text-sm border border-gray-300"
              title="Clear ending ID"
            >
              ×
            </button>
          </div>
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

        {/* Usage Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Usage Type *
          </label>
          <select
            value={createForm.usage_type}
            onChange={(e) => setCreateForm({ ...createForm, usage_type: e.target.value })}
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

        {/* Save Button */}
        <div className="pt-4 border-t border-gray-200">
          <button
            onClick={handleSaveRoute}
            disabled={!isPreviewMode || !createForm.name || !createForm.usage_type}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer"
          >
            Save Route to Database
          </button>

          <p className="text-xs text-gray-500 mt-2">
            Fill in all required fields and click Save to create the railway route.
          </p>
        </div>
      </div>
    </div>
  );
}
