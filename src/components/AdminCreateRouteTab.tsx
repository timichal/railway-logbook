'use client';

import React, { useState, useEffect } from 'react';
import { usageOptions, frequencyOptions, type UsageType } from '@/lib/constants';
import { findRailwayPathDB, getRailwayPartsByIds } from '@/lib/adminMapActions';
import { saveRailwayRoute } from '@/lib/adminRouteActions';
import { getSplitForPart, splitRailwayPart, removeSplit } from '@/lib/railwayPartSplitsActions';
import type { RailwayPart } from '@/lib/types';
import { useToast } from '@/lib/toast';

interface AdminCreateRouteTabProps {
  startingId: string;
  endingId: string;
  onStartingIdChange: (id: string) => void;
  onEndingIdChange: (id: string) => void;
  onPreviewRoute?: (partIds: string[], coordinates: [number, number][], railwayParts: RailwayPart[]) => void;
  isPreviewMode?: boolean;
  onCancelPreview?: () => void;
  onSaveRoute?: (routeData: { from_station: string, to_station: string, track_number: string, description: string, usage_type: UsageType, frequency: string[], link: string }) => void;
  onFormReset?: () => void;
  editingGeometryForTrackId?: string | null;
  onGeometryEditComplete?: () => void;
  onCancelGeometryEdit?: () => void;
  onSplitModeActivate?: (partId: string, fieldTarget: 'starting' | 'ending') => void;
  onSplitModeDeactivate?: () => void;
  isSplitMode?: boolean;
  splittingPartId?: string | null;
  userId?: number;
  splitCompletedTrigger?: number; // Incremented when a split operation completes
}

export default function AdminCreateRouteTab({
  startingId,
  endingId,
  onStartingIdChange,
  onEndingIdChange,
  onPreviewRoute,
  isPreviewMode,
  onCancelPreview,
  onSaveRoute,
  onFormReset,
  editingGeometryForTrackId,
  onGeometryEditComplete,
  onCancelGeometryEdit,
  onSplitModeActivate,
  onSplitModeDeactivate,
  isSplitMode,
  splittingPartId,
  userId = 1, // Default to admin user
  splitCompletedTrigger = 0
}: AdminCreateRouteTabProps) {
  const { showError, showSuccess } = useToast();

  // Track split states for starting and ending parts
  const [startingSplitExists, setStartingSplitExists] = useState(false);
  const [endingSplitExists, setEndingSplitExists] = useState(false);
  const [splitCheckTrigger, setSplitCheckTrigger] = useState(0); // Force re-check

  // Create route form state (without the IDs that are managed by parent)
  const [createForm, setCreateForm] = useState({
    from_station: '',
    to_station: '',
    track_number: '',
    description: '',
    usage_type: undefined as UsageType | undefined,
    frequency: [] as string[],
    link: ''
  });

  // Store the current path result and railway parts for geometry updates
  const [currentPathResult, setCurrentPathResult] = useState<{ partIds: string[], coordinates: [number, number][], railwayParts: RailwayPart[] } | null>(null);

  // Reset form function
  const resetForm = () => {
    setCreateForm({
      from_station: '',
      to_station: '',
      track_number: '',
      description: '',
      usage_type: undefined,
      frequency: [],
      link: ''
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

      // Store the path result for potential geometry updates
      setCurrentPathResult({ partIds: result.partIds, coordinates: result.coordinates, railwayParts });

      // Pass both the path result and the individual railway parts
      onPreviewRoute(result.partIds, result.coordinates, railwayParts);
    } else {
      console.error('Preview: No path found between', startingId, 'and', endingId);
      showError('No path found between the selected railway parts within 150km. Make sure both parts are connected through the railway network.');
    }
  };

  // Handle save route functionality
  const handleSaveRoute = async () => {
    if (!onSaveRoute || createForm.usage_type === undefined) return;

    await onSaveRoute({
      from_station: createForm.from_station.trim(),
      to_station: createForm.to_station.trim(),
      track_number: createForm.track_number,
      description: createForm.description,
      usage_type: createForm.usage_type,
      frequency: createForm.frequency,
      link: createForm.link
    });

    // Reset form after successful save
    resetForm();
  };

  // Handle save geometry for existing route
  const handleSaveGeometry = async () => {
    if (!editingGeometryForTrackId || !currentPathResult) {
      console.error('Cannot save geometry: missing track ID or path result');
      return;
    }

    try {
      // Use saveRailwayRoute with trackId to trigger UPDATE mode
      // Metadata (name, description, usage_type, track_number, frequency, link) won't be used in update mode
      await saveRailwayRoute(
        { from_station: '', to_station: '', description: '', usage_type: 0, track_number: '', frequency: [], link: '' }, // Dummy data, not used in UPDATE mode
        { partIds: currentPathResult.partIds, coordinates: currentPathResult.coordinates },
        currentPathResult.railwayParts,
        editingGeometryForTrackId // Pass track ID to trigger UPDATE query
      );

      showSuccess('Route geometry updated successfully!');

      // Clear preview route
      if (onCancelPreview) {
        onCancelPreview();
      }

      // Reset and complete editing
      resetForm();
      setCurrentPathResult(null);

      if (onGeometryEditComplete) {
        onGeometryEditComplete();
      }
    } catch (error) {
      console.error('Error updating route geometry:', error);
      showError(`Error updating route geometry: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Handle cancel geometry edit
  const handleCancelGeometryEdit = () => {
    // Clear preview route
    if (onCancelPreview) {
      onCancelPreview();
    }

    // Reset form and path result
    resetForm();
    setCurrentPathResult(null);

    // Call parent callback to exit edit mode
    if (onCancelGeometryEdit) {
      onCancelGeometryEdit();
    }
  };

  // Trigger split check when parent notifies of split completion
  useEffect(() => {
    if (splitCompletedTrigger > 0) {
      setSplitCheckTrigger(prev => prev + 1);
    }
  }, [splitCompletedTrigger]);

  // Helper to extract original part ID from segment ID
  const extractOriginalPartId = (partId: string): string => {
    const match = partId.match(/^(\d+)_seg[01]$/);
    return match ? match[1] : partId;
  };

  // Check if splits exist for starting and ending parts
  useEffect(() => {
    async function checkSplits() {
      if (startingId) {
        // Extract original part ID if this is a segment
        const originalPartId = extractOriginalPartId(startingId);
        const split = await getSplitForPart(originalPartId);
        setStartingSplitExists(!!split);
      } else {
        setStartingSplitExists(false);
      }
    }
    checkSplits();
  }, [startingId, splitCheckTrigger]);

  useEffect(() => {
    async function checkSplits() {
      if (endingId) {
        // Extract original part ID if this is a segment
        const originalPartId = extractOriginalPartId(endingId);
        const split = await getSplitForPart(originalPartId);
        setEndingSplitExists(!!split);
      } else {
        setEndingSplitExists(false);
      }
    }
    checkSplits();
  }, [endingId, splitCheckTrigger]);

  // Handlers for split mode
  const handleSplitPart = (partId: string, fieldTarget: 'starting' | 'ending') => {
    if (onSplitModeActivate) {
      // Extract original part ID if this is a segment
      const originalPartId = extractOriginalPartId(partId);
      onSplitModeActivate(originalPartId, fieldTarget);
    }
  };

  const handleRemoveSplit = async (partId: string) => {
    try {
      // Extract original part ID if this is a segment
      const originalPartId = extractOriginalPartId(partId);
      const result = await removeSplit(originalPartId, userId);
      if (result.success) {
        showSuccess('Split removed successfully!');
        // Refresh split status
        if (extractOriginalPartId(startingId) === originalPartId) {
          setStartingSplitExists(false);
        }
        if (extractOriginalPartId(endingId) === originalPartId) {
          setEndingSplitExists(false);
        }
        // Trigger preview refresh
        if (onCancelPreview) {
          onCancelPreview();
        }
      } else {
        showError(`Error removing split: ${result.error}`);
      }
    } catch (error) {
      showError(`Error removing split: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Automatically preview route when both IDs are filled
  useEffect(() => {
    if (startingId && endingId && !isPreviewMode) {
      handlePreviewRoute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startingId, endingId, isPreviewMode]);

  const isEditMode = !!editingGeometryForTrackId;

  return (
    <div className="p-4 overflow-y-auto">
      <h3 className="font-semibold text-gray-900 mb-4">
        {isEditMode ? `Edit Route Geometry (Track ID: ${editingGeometryForTrackId})` : 'Create New Route'}
      </h3>
      <p className="text-sm text-gray-600 mb-4">
        Click on railway parts in the map to set starting and ending points. The route will be automatically previewed on the map.
        {isEditMode && ' The route metadata (name, description) will remain unchanged.'}
      </p>

      <div className="space-y-4">
        {/* Starting ID */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Starting Part ID * {startingSplitExists && <span className="text-purple-600 text-xs">(Split)</span>}
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
            {startingId && (
              <>
                {!startingSplitExists ? (
                  <button
                    onClick={() => handleSplitPart(startingId, 'starting')}
                    className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    title={isSplitMode ? "Already splitting a part" : "Split this railway part"}
                    disabled={isSplitMode && splittingPartId !== extractOriginalPartId(startingId)}
                  >
                    {isSplitMode && splittingPartId === extractOriginalPartId(startingId) ? 'Splitting...' : 'Split'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleRemoveSplit(startingId)}
                    className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Remove split from this part"
                    disabled={isSplitMode}
                  >
                    Unsplit
                  </button>
                )}
              </>
            )}
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
            Ending Part ID * {endingSplitExists && <span className="text-purple-600 text-xs">(Split)</span>}
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
            {endingId && (
              <>
                {!endingSplitExists ? (
                  <button
                    onClick={() => handleSplitPart(endingId, 'ending')}
                    className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    title={isSplitMode ? "Already splitting a part" : "Split this railway part"}
                    disabled={isSplitMode && splittingPartId !== extractOriginalPartId(endingId)}
                  >
                    {isSplitMode && splittingPartId === extractOriginalPartId(endingId) ? 'Splitting...' : 'Split'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleRemoveSplit(endingId)}
                    className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Remove split from this part"
                    disabled={isSplitMode}
                  >
                    Unsplit
                  </button>
                )}
              </>
            )}
            <button
              onClick={clearEndingId}
              className="px-2 py-2 text-red-600 hover:bg-red-50 rounded-md text-sm border border-gray-300"
              title="Clear ending ID"
            >
              ×
            </button>
          </div>
        </div>

        {/* Only show metadata fields in create mode */}
        {!isEditMode && (
          <>
            {/* Track Number */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Local route number(s)
              </label>
              <input
                type="text"
                value={createForm.track_number}
                onChange={(e) => setCreateForm({ ...createForm, track_number: e.target.value })}
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
                value={createForm.from_station}
                onChange={(e) => setCreateForm({ ...createForm, from_station: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                placeholder="Starting station"
              />
            </div>

            {/* To Station */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                To *
              </label>
              <input
                type="text"
                value={createForm.to_station}
                onChange={(e) => setCreateForm({ ...createForm, to_station: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                placeholder="Ending station"
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

            {/* Link */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Link (URL)
              </label>
              <input
                type="url"
                value={createForm.link}
                onChange={(e) => setCreateForm({ ...createForm, link: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                placeholder="https://example.com"
              />
            </div>

            {/* Usage Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Usage Type *
              </label>
              <div className="flex gap-4">
                {usageOptions.map((option) => (
                  <label key={option.key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="usage_type"
                      value={option.id}
                      checked={createForm.usage_type === option.id}
                      onChange={(e) => setCreateForm({ ...createForm, usage_type: Number(e.target.value) as UsageType })}
                      className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    />
                    <span className="text-sm text-gray-700">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Frequency Tags */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Frequency Tags
              </label>
              <div className="flex flex-wrap gap-4">
                {frequencyOptions.map((option) => (
                  <label key={option.key} className="flex  flex-[0_1_30%] items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createForm.frequency.includes(option.key)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setCreateForm({ ...createForm, frequency: [...createForm.frequency, option.key] });
                        } else {
                          setCreateForm({ ...createForm, frequency: createForm.frequency.filter(f => f !== option.key) });
                        }
                      }}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    />
                    <span className="text-sm text-gray-700">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Save Button */}
        <div className="pt-4 border-t border-gray-200">
          {isEditMode ? (
            <>
              <button
                onClick={handleCancelGeometryEdit}
                className="w-full bg-gray-500 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer mb-2"
              >
                Cancel
              </button>

              <button
                onClick={handleSaveGeometry}
                disabled={!isPreviewMode}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer"
              >
                Save New Geometry
              </button>

              <p className="text-xs text-gray-500 mt-2">
                Select new starting and ending points on the map, then click Save to update the route geometry.
              </p>
            </>
          ) : (
            <>
              <button
                onClick={handleSaveRoute}
                disabled={!isPreviewMode || !createForm.from_station || !createForm.to_station || createForm.usage_type === undefined}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer"
              >
                Save Route to Database
              </button>

              <p className="text-xs text-gray-500 mt-2">
                Fill in all required fields and click Save to create the railway route.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
