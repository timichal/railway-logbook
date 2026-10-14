"use client";

import { useState } from "react";
import PickedPointField from "@/components/admin/PickedPointField";
import RouteMetadataFields, {
  routeMetadataIncomplete,
} from "@/components/admin/RouteMetadataFields";
import { unwrap } from "@/lib/actionResult";
import {
  type AdminRouteDetail,
  type SaveRouteData,
  saveRailwayRoute,
} from "@/lib/adminRouteActions";
import type { CreateFormCoordinates, PathPreview } from "@/lib/map/hooks/useRoutePreview";
import { useRegion } from "@/lib/regionContext";
import { useToast } from "@/lib/toast";
import { btn } from "@/lib/ui/buttonStyles";
import { useSingleFlight } from "@/lib/ui/useSingleFlight";

/** A geometry edit in progress: the route whose points are being re-picked. */
export type EditingGeometry = Pick<AdminRouteDetail, "track_id" | "from_station" | "to_station">;

const EMPTY_FORM: SaveRouteData = {
  name: "",
  from_station: "",
  to_station: "",
  description: "",
  // Default to Regular — the overwhelming majority of routes, saves a click
  usage_type: 0,
  frequency: [],
  link: "",
  intended_backtracking: false,
};

interface AdminCreateRouteTabProps {
  /** The picked points, owned by the page (see `AdminPageClient`). */
  coordinates: CreateFormCoordinates;
  onCoordinatesChange: React.Dispatch<React.SetStateAction<CreateFormCoordinates>>;
  /**
   * The page's preview (`useRoutePreview`), which is also what gets saved. Read from
   * the page rather than kept here as well: this tab unmounts with the mobile
   * drawer, and a copy of its own came back empty beside a preview still on the
   * map, leaving Save enabled and doing nothing.
   */
  previewRoute: PathPreview | null;
  /**
   * Throws on failure, which this tab reports. The page clears the points (and so
   * the preview) on success; this tab then clears only its own fields.
   */
  onSaveRoute?: (routeData: SaveRouteData) => Promise<void>;
  /** Set while an existing route's geometry is re-picked instead of a route created. */
  editingGeometry: EditingGeometry | null;
  /** Called with the saved path once a new geometry is saved; the sidebar ends the edit and clears the form. */
  onGeometryEditComplete?: (saved: PathPreview) => void;
  onCancelGeometryEdit?: () => void;
  availableTags?: string[];
  onTagsChanged?: () => void;
}

export default function AdminCreateRouteTab({
  coordinates,
  onCoordinatesChange,
  previewRoute,
  onSaveRoute,
  editingGeometry,
  onGeometryEditComplete,
  onCancelGeometryEdit,
  availableTags = [],
  onTagsChanged,
}: AdminCreateRouteTabProps) {
  const { showSuccess } = useToast();
  const region = useRegion();
  const isPreviewMode = previewRoute !== null;
  const { busy: isSaving, run } = useSingleFlight();

  const [createForm, setCreateForm] = useState(EMPTY_FORM);

  const handleSaveRoute = async () => {
    if (!onSaveRoute || !previewRoute) return;
    await run("save the route", async () => {
      await onSaveRoute({
        ...createForm,
        name: createForm.name.trim(),
        from_station: createForm.from_station.trim(),
        to_station: createForm.to_station.trim(),
      });
      setCreateForm(EMPTY_FORM);

      // A newly created route may introduce new tags; refresh the suggestion set.
      onTagsChanged?.();
    });
  };

  const handleSaveGeometry = async () => {
    if (!editingGeometry || !previewRoute) return;
    await run("update the route geometry", async () => {
      // With a track id, saveRailwayRoute updates the geometry and ignores the metadata
      unwrap(
        await saveRailwayRoute(
          EMPTY_FORM,
          {
            partIds: previewRoute.partIds,
            coordinates: previewRoute.coordinates,
            hasBacktracking: previewRoute.hasBacktracking,
          },
          previewRoute.startCoordinate,
          previewRoute.endCoordinate,
          editingGeometry.track_id,
        ),
      );
      showSuccess("Route geometry updated successfully!");
      onGeometryEditComplete?.(previewRoute);
    });
  };

  const isEditMode = editingGeometry !== null;

  return (
    <div className="p-4 overflow-y-auto">
      <h3 className="font-semibold text-gray-900 mb-4">
        {editingGeometry
          ? `Edit Route Geometry (${editingGeometry.from_station} ⟷ ${editingGeometry.to_station})`
          : "Create New Route"}
      </h3>
      <p className="text-sm text-gray-600 mb-4">
        Click on railway parts in the map to set starting and ending points. The route will be
        automatically previewed on the map.
        {isEditMode && " The route metadata (name, description) will remain unchanged."}
      </p>

      <div className="space-y-4">
        <PickedPointField
          id="route-starting-point"
          label="Starting Point *"
          coordinate={coordinates.startingCoordinate}
          locked={isPreviewMode}
          // Clearing a point drops the preview with it (`useRoutePreview`).
          onClear={() => onCoordinatesChange((prev) => ({ ...prev, startingCoordinate: null }))}
        />
        <PickedPointField
          id="route-ending-point"
          label="Ending Point *"
          coordinate={coordinates.endingCoordinate}
          locked={isPreviewMode}
          onClear={() => onCoordinatesChange((prev) => ({ ...prev, endingCoordinate: null }))}
        />

        {!isEditMode && (
          <RouteMetadataFields
            value={createForm}
            onChange={setCreateForm}
            idPrefix="route"
            layout="wide"
            availableTags={availableTags}
          />
        )}

        <div className="pt-4 border-t border-gray-200">
          {isEditMode ? (
            <>
              <button
                type="button"
                onClick={onCancelGeometryEdit}
                disabled={isSaving}
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
