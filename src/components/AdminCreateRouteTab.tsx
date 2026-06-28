"use client";

import { useEffect, useState } from "react";
import { findRailwayPathFromCoordinates, getRailwayPartsByIds } from "@/lib/adminMapActions";
import { saveRailwayRoute } from "@/lib/adminRouteActions";
import { frequencyOptions, type UsageType, usageOptions } from "@/lib/constants";
import { useToast } from "@/lib/toast";
import type { RailwayPart } from "@/lib/types";

interface AdminCreateRouteTabProps {
  startingCoordinate: [number, number] | null;
  endingCoordinate: [number, number] | null;
  onStartingCoordinateChange: (coord: [number, number] | null) => void;
  onEndingCoordinateChange: (coord: [number, number] | null) => void;
  onPreviewRoute?: (
    partIds: string[],
    coordinates: [number, number][],
    railwayParts: RailwayPart[],
    startCoordinate: [number, number],
    endCoordinate: [number, number],
    hasBacktracking?: boolean,
  ) => void;
  isPreviewMode?: boolean;
  onCancelPreview?: () => void;
  onSaveRoute?: (routeData: {
    from_station: string;
    to_station: string;
    description: string;
    usage_type: UsageType;
    frequency: string[];
    link: string;
    scenic: boolean;
    intended_backtracking: boolean;
  }) => void;
  onFormReset?: () => void;
  editingGeometryForTrackId?: string | null;
  editingRouteInfo?: { from_station: string; to_station: string } | null;
  onGeometryEditComplete?: () => void;
  onCancelGeometryEdit?: () => void;
  onRefreshMap?: () => void;
}

export default function AdminCreateRouteTab({
  startingCoordinate,
  endingCoordinate,
  onStartingCoordinateChange,
  onEndingCoordinateChange,
  onPreviewRoute,
  isPreviewMode,
  onCancelPreview,
  onSaveRoute,
  onFormReset,
  editingGeometryForTrackId,
  editingRouteInfo,
  onGeometryEditComplete,
  onCancelGeometryEdit,
}: AdminCreateRouteTabProps) {
  const { showError, showSuccess } = useToast();

  // Create route form state (without the coordinates that are managed by parent)
  const [createForm, setCreateForm] = useState({
    from_station: "",
    to_station: "",
    description: "",
    usage_type: undefined as UsageType | undefined,
    frequency: [] as string[],
    link: "",
    scenic: false,
    intended_backtracking: false,
  });

  // Store the current path result and railway parts for geometry updates
  const [currentPathResult, setCurrentPathResult] = useState<{
    partIds: string[];
    coordinates: [number, number][];
    railwayParts: RailwayPart[];
    startCoordinate: [number, number];
    endCoordinate: [number, number];
    hasBacktracking?: boolean;
  } | null>(null);

  // Reset form function
  const resetForm = () => {
    setCreateForm({
      from_station: "",
      to_station: "",
      description: "",
      usage_type: undefined,
      frequency: [],
      link: "",
      scenic: false,
      intended_backtracking: false,
    });
    // Clear the coordinates managed by parent via callback
    if (onFormReset) {
      onFormReset();
    }
  };

  // Clear starting coordinate
  const clearStartingCoordinate = () => {
    onStartingCoordinateChange(null);
    if (onCancelPreview) {
      onCancelPreview();
    }
  };

  // Clear ending coordinate
  const clearEndingCoordinate = () => {
    onEndingCoordinateChange(null);
    if (onCancelPreview) {
      onCancelPreview();
    }
  };

  // Handle preview route functionality
  const handlePreviewRoute = async () => {
    if (!startingCoordinate || !endingCoordinate || !onPreviewRoute) {
      console.error("Preview: Missing starting coordinate, ending coordinate, or preview callback");
      return;
    }

    console.log("Preview: Finding path from", startingCoordinate, "to", endingCoordinate);

    // Use coordinate-based server action to find path
    const result = await findRailwayPathFromCoordinates(startingCoordinate, endingCoordinate);

    if (result) {
      console.log("Preview: Path found!");
      console.log("Part IDs:", result.partIds);
      console.log("Has backtracking:", result.hasBacktracking);

      // Fetch the actual railway part geometries from the database
      const railwayParts = await getRailwayPartsByIds(result.partIds);
      console.log("Preview: Fetched", railwayParts.length, "railway part geometries");

      // Store the path result for potential geometry updates
      setCurrentPathResult({
        partIds: result.partIds,
        coordinates: result.coordinates,
        railwayParts,
        startCoordinate: startingCoordinate,
        endCoordinate: endingCoordinate,
        hasBacktracking: result.hasBacktracking,
      });

      // Pass both the path result, the individual railway parts, and the start/end coordinates
      onPreviewRoute(
        result.partIds,
        result.coordinates,
        railwayParts,
        startingCoordinate,
        endingCoordinate,
        result.hasBacktracking,
      );
    } else {
      console.error("Preview: No path found between coordinates");
      showError(
        "No path found between the selected coordinates within 222km. Make sure both points are on connected railway parts.",
      );
    }
  };

  // Handle save route functionality
  const handleSaveRoute = async () => {
    if (!onSaveRoute || createForm.usage_type === undefined || !currentPathResult) return;

    await onSaveRoute({
      from_station: createForm.from_station.trim(),
      to_station: createForm.to_station.trim(),
      description: createForm.description,
      usage_type: createForm.usage_type,
      frequency: createForm.frequency,
      link: createForm.link,
      scenic: createForm.scenic,
      intended_backtracking: createForm.intended_backtracking,
    });

    // Reset form after successful save
    resetForm();
  };

  // Handle save geometry for existing route
  const handleSaveGeometry = async () => {
    if (!editingGeometryForTrackId || !currentPathResult) {
      console.error("Cannot save geometry: missing track ID or path result");
      return;
    }

    try {
      // Use saveRailwayRoute with trackId to trigger UPDATE mode
      // Metadata (name, description, usage_type, frequency, link, scenic, line_class, intended_backtracking) won't be used in update mode
      await saveRailwayRoute(
        {
          from_station: "",
          to_station: "",
          description: "",
          usage_type: 0,
          frequency: [],
          link: "",
          scenic: false,
          intended_backtracking: false,
        }, // Dummy data, not used in UPDATE mode
        {
          partIds: currentPathResult.partIds,
          coordinates: currentPathResult.coordinates,
          hasBacktracking: currentPathResult.hasBacktracking,
        },
        currentPathResult.startCoordinate,
        currentPathResult.endCoordinate,
        editingGeometryForTrackId, // Pass track ID to trigger UPDATE query
      );

      showSuccess("Route geometry updated successfully!");

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
      console.error("Error updating route geometry:", error);
      showError(
        `Error updating route geometry: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
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

  // Automatically preview route when both coordinates are filled
  // biome-ignore lint/correctness/useExhaustiveDependencies: handlePreviewRoute is intentionally omitted; including it would re-run on every render and loop. The effect should fire only when the coordinates or preview mode change.
  useEffect(() => {
    if (startingCoordinate && endingCoordinate && !isPreviewMode) {
      handlePreviewRoute();
    }
  }, [startingCoordinate, endingCoordinate, isPreviewMode]);

  const isEditMode = !!editingGeometryForTrackId;

  // Format coordinate for display
  const formatCoordinate = (coord: [number, number] | null) => {
    if (!coord) return "";
    return `${coord[1].toFixed(6)}, ${coord[0].toFixed(6)}`;
  };

  // Format header for edit mode
  const getEditModeHeader = () => {
    if (!isEditMode || !editingRouteInfo) {
      return "Create New Route";
    }

    return `Edit Route Geometry (${editingRouteInfo.from_station} ⟷ ${editingRouteInfo.to_station})`;
  };

  return (
    <div className="p-4 overflow-y-auto">
      <h3 className="font-semibold text-gray-900 mb-4">{getEditModeHeader()}</h3>
      <p className="text-sm text-gray-600 mb-4">
        Click on railway parts in the map to set starting and ending points. The route will be
        automatically previewed on the map.
        {isEditMode && " The route metadata (name, description) will remain unchanged."}
      </p>

      <div className="space-y-4">
        {/* Starting Coordinate */}
        <div>
          <label
            htmlFor="route-starting-point"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Starting Point *
          </label>
          <div className="flex gap-2">
            <input
              id="route-starting-point"
              type="text"
              value={formatCoordinate(startingCoordinate)}
              readOnly
              placeholder="Click a railway part on the map"
              disabled={isPreviewMode}
              className={`flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black ${
                isPreviewMode ? "bg-gray-100 cursor-not-allowed" : "bg-gray-50"
              }`}
            />
            <button
              type="button"
              onClick={clearStartingCoordinate}
              className="px-2 py-2 text-red-600 hover:bg-red-50 rounded-md text-sm border border-gray-300"
              title="Clear starting coordinate"
            >
              ×
            </button>
          </div>
        </div>

        {/* Ending Coordinate */}
        <div>
          <label
            htmlFor="route-ending-point"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Ending Point *
          </label>
          <div className="flex gap-2">
            <input
              id="route-ending-point"
              type="text"
              value={formatCoordinate(endingCoordinate)}
              readOnly
              placeholder="Click a railway part on the map"
              disabled={isPreviewMode}
              className={`flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black ${
                isPreviewMode ? "bg-gray-100 cursor-not-allowed" : "bg-gray-50"
              }`}
            />
            <button
              type="button"
              onClick={clearEndingCoordinate}
              className="px-2 py-2 text-red-600 hover:bg-red-50 rounded-md text-sm border border-gray-300"
              title="Clear ending coordinate"
            >
              ×
            </button>
          </div>
        </div>

        {/* Only show metadata fields in create mode */}
        {!isEditMode && (
          <>
            {/* From Station */}
            <div>
              <label htmlFor="route-from" className="block text-sm font-medium text-gray-700 mb-1">
                From *
              </label>
              <input
                id="route-from"
                type="text"
                value={createForm.from_station}
                onChange={(e) => setCreateForm({ ...createForm, from_station: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                placeholder="Starting station"
              />
            </div>

            {/* To Station */}
            <div>
              <label htmlFor="route-to" className="block text-sm font-medium text-gray-700 mb-1">
                To *
              </label>
              <input
                id="route-to"
                type="text"
                value={createForm.to_station}
                onChange={(e) => setCreateForm({ ...createForm, to_station: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                placeholder="Ending station"
              />
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="route-description"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Description
              </label>
              <textarea
                id="route-description"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                placeholder="Enter route description"
              />
            </div>

            {/* Link */}
            <div>
              <label htmlFor="route-link" className="block text-sm font-medium text-gray-700 mb-1">
                Link (URL)
              </label>
              <input
                id="route-link"
                type="url"
                value={createForm.link}
                onChange={(e) => setCreateForm({ ...createForm, link: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
                placeholder="https://example.com"
              />
            </div>

            {/* Usage Type */}
            <div>
              <span className="block text-sm font-medium text-gray-700 mb-2">Usage Type *</span>
              <div className="flex gap-4">
                {usageOptions.map((option) => (
                  <label key={option.key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="usage_type"
                      value={option.id}
                      checked={createForm.usage_type === option.id}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          usage_type: Number(e.target.value) as UsageType,
                        })
                      }
                      className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    />
                    <span className="text-sm text-gray-700">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Frequency Tags */}
            <div>
              <span className="block text-sm font-medium text-gray-700 mb-2">Frequency Tags</span>
              <div className="flex flex-wrap gap-4">
                {frequencyOptions.map((option) => (
                  <label
                    key={option.key}
                    className="flex flex-[0_1_30%] items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={createForm.frequency.includes(option.key)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setCreateForm({
                            ...createForm,
                            frequency: [...createForm.frequency, option.key],
                          });
                        } else {
                          setCreateForm({
                            ...createForm,
                            frequency: createForm.frequency.filter((f) => f !== option.key),
                          });
                        }
                      }}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    />
                    <span className="text-sm text-gray-700">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <span className="block text-sm font-medium text-gray-700 mb-2">Other</span>
            <div className="flex flex-wrap gap-4">
              {/* Scenic */}
              <div className="flex-[0_1_30%]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createForm.scenic}
                    onChange={(e) => setCreateForm({ ...createForm, scenic: e.target.checked })}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  />
                  <span className="text-sm font-medium text-gray-700">Scenic route</span>
                </label>
              </div>

              {/* Intended Backtracking */}
              <div className="flex-[0_1_30%]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createForm.intended_backtracking}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, intended_backtracking: e.target.checked })
                    }
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  />
                  <span className="text-sm font-medium text-gray-700">Intended backtracking</span>
                </label>
              </div>
            </div>
          </>
        )}

        {/* Save Button */}
        <div className="pt-4 border-t border-gray-200">
          {isEditMode ? (
            <>
              <button
                type="button"
                onClick={handleCancelGeometryEdit}
                className="w-full bg-gray-500 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer mb-2"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleSaveGeometry}
                disabled={!isPreviewMode}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer"
              >
                Save New Geometry
              </button>

              <p className="text-xs text-gray-500 mt-2">
                Select new starting and ending points on the map, then click Save to update the
                route geometry.
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleSaveRoute}
                disabled={
                  !isPreviewMode ||
                  !createForm.from_station ||
                  !createForm.to_station ||
                  createForm.usage_type === undefined
                }
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
