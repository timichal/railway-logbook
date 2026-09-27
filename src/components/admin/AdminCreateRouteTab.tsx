"use client";

import { useRef, useState } from "react";
import RouteMetadataFields, {
  routeMetadataIncomplete,
} from "@/components/admin/RouteMetadataFields";
import { actionErrorMessage, unwrap } from "@/lib/actionResult";
import { type SaveRouteData, saveRailwayRoute } from "@/lib/adminRouteActions";
import type { PathPreview } from "@/lib/map/hooks/useRoutePreview";
import { useRegion } from "@/lib/regionContext";
import { useToast } from "@/lib/toast";
import { btn, iconBtn } from "@/lib/ui/buttonStyles";

/** The create form's two picked points (also what a geometry edit re-picks). */
export interface CreateFormCoordinates {
  startingCoordinate: [number, number] | null;
  endingCoordinate: [number, number] | null;
}

/** A geometry edit in progress; `routeInfo` arrives once the route has loaded. */
export interface EditingGeometry {
  trackId: number;
  routeInfo: { from_station: string; to_station: string } | null;
}

const EMPTY_FORM: SaveRouteData = {
  name: "",
  from_station: "",
  to_station: "",
  description: "",
  // Default to Regular — the overwhelming majority of routes, saves a click
  usage_type: 0,
  frequency: [],
  link: "",
  scenic: false,
  intended_backtracking: false,
};

interface AdminCreateRouteTabProps {
  startingCoordinate: [number, number] | null;
  endingCoordinate: [number, number] | null;
  onStartingCoordinateChange: (coord: [number, number] | null) => void;
  onEndingCoordinateChange: (coord: [number, number] | null) => void;
  /**
   * The page's preview (`useRoutePreview`), which is also what gets saved. Read from
   * the page rather than kept here as well: this tab unmounts with the mobile
   * drawer, and a copy of its own came back empty beside a preview still on the
   * map, leaving Save enabled and doing nothing.
   */
  previewRoute: PathPreview | null;
  /**
   * Resolves whether the route was saved. The page clears the points (and so the
   * preview) on success; this tab then clears only its own fields.
   */
  onSaveRoute?: (routeData: SaveRouteData) => Promise<boolean>;
  editingGeometryForTrackId?: number | null;
  editingRouteInfo?: { from_station: string; to_station: string } | null;
  /** Called once a new geometry is saved; the sidebar ends the edit and clears the form. */
  onGeometryEditComplete?: () => void;
  onCancelGeometryEdit?: () => void;
  availableTags?: string[];
  onTagsChanged?: () => void;
}

export default function AdminCreateRouteTab({
  startingCoordinate,
  endingCoordinate,
  onStartingCoordinateChange,
  onEndingCoordinateChange,
  previewRoute,
  onSaveRoute,
  editingGeometryForTrackId,
  editingRouteInfo,
  onGeometryEditComplete,
  onCancelGeometryEdit,
  availableTags = [],
  onTagsChanged,
}: AdminCreateRouteTabProps) {
  const { showError, showSuccess } = useToast();
  const region = useRegion();
  const isPreviewMode = previewRoute !== null;
  // Held across the save's round trip, so a second click cannot save twice. The
  // ref is the guard: it is set synchronously, while the state that disables the
  // button only lands on the next render — two clicks in one task both got past it.
  const savingRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);

  // Create route form state (without the coordinates that are managed by parent)
  const [createForm, setCreateForm] = useState(EMPTY_FORM);

  // Clearing a point drops the preview with it (`useRoutePreview`).
  const clearStartingCoordinate = () => onStartingCoordinateChange(null);
  const clearEndingCoordinate = () => onEndingCoordinateChange(null);

  // Handle save route functionality
  const handleSaveRoute = async () => {
    if (savingRef.current || !onSaveRoute || !previewRoute) return;

    savingRef.current = true;
    setIsSaving(true);
    try {
      const saved = await onSaveRoute({
        ...createForm,
        name: createForm.name.trim(),
        from_station: createForm.from_station.trim(),
        to_station: createForm.to_station.trim(),
      });
      // The parent has already reported a failure; keep the form for a retry.
      if (!saved) return;

      setCreateForm(EMPTY_FORM);

      // A newly created route may introduce new tags; refresh the suggestion set.
      onTagsChanged?.();
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  // Handle save geometry for existing route
  const handleSaveGeometry = async () => {
    if (savingRef.current) return;
    if (!editingGeometryForTrackId || !previewRoute) {
      console.error("Cannot save geometry: missing track ID or path result");
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    try {
      // Use saveRailwayRoute with trackId to trigger UPDATE mode
      // Metadata (name, description, usage_type, frequency, link, scenic, line_class, intended_backtracking) won't be used in update mode
      unwrap(
        await saveRailwayRoute(
          EMPTY_FORM, // Not used in UPDATE mode
          {
            partIds: previewRoute.partIds,
            coordinates: previewRoute.coordinates,
            hasBacktracking: previewRoute.hasBacktracking,
          },
          previewRoute.startCoordinate,
          previewRoute.endCoordinate,
          editingGeometryForTrackId, // Pass track ID to trigger UPDATE query
        ),
      );

      showSuccess("Route geometry updated successfully!");
      onGeometryEditComplete?.();
    } catch (error) {
      console.error("Error updating route geometry:", error);
      showError(`Error updating route geometry: ${actionErrorMessage(error)}`);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

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
              className={`flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-fg ${
                isPreviewMode ? "bg-gray-100 cursor-not-allowed" : "bg-gray-50"
              }`}
            />
            <button
              type="button"
              onClick={clearStartingCoordinate}
              className={`${iconBtn("sm", "danger")} self-center`}
              title="Clear starting point"
              aria-label="Clear starting point"
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
              className={`flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-fg ${
                isPreviewMode ? "bg-gray-100 cursor-not-allowed" : "bg-gray-50"
              }`}
            />
            <button
              type="button"
              onClick={clearEndingCoordinate}
              className={`${iconBtn("sm", "danger")} self-center`}
              title="Clear ending point"
              aria-label="Clear ending point"
            >
              ×
            </button>
          </div>
        </div>

        {/* Only show metadata fields in create mode */}
        {!isEditMode && (
          <RouteMetadataFields
            value={createForm}
            onChange={setCreateForm}
            idPrefix="route"
            layout="wide"
            availableTags={availableTags}
          />
        )}

        {/* Save Button */}
        <div className="pt-4 border-t border-gray-200">
          {isEditMode ? (
            <>
              <button
                type="button"
                onClick={onCancelGeometryEdit}
                className={`${btn("neutral", "md")} w-full mb-2`}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleSaveGeometry}
                disabled={!isPreviewMode || isSaving}
                className={`${btn("success", "md")} w-full`}
              >
                {isSaving ? "Saving…" : "Save New Geometry"}
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
                  isSaving ||
                  !isPreviewMode ||
                  routeMetadataIncomplete(createForm, region.hasRouteNames)
                }
                className={`${btn("success", "md")} w-full`}
              >
                {isSaving ? "Saving…" : "Save Route to Database"}
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
