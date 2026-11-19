"use client";

import { useEffect, useState } from "react";
import PickedPointField from "@/components/admin/PickedPointField";
import RouteMetadataFields, {
  NO_ROUTE_SUGGESTIONS,
  routeMetadataIncomplete,
} from "@/components/admin/RouteMetadataFields";
import { unwrap } from "@/lib/actionResult";
import { fetchPartialRideCount } from "@/lib/adminReads";
import {
  type AdminRouteDetail,
  type RouteSuggestions,
  type SaveRouteData,
  saveRailwayRoute,
} from "@/lib/adminRouteActions";
import type { CreateFormCoordinates, PathPreview } from "@/lib/map/hooks/useRoutePreview";
import { useRegion } from "@/lib/regionContext";
import { routeTitle } from "@/lib/shared/map/routeFeature";
import { useToast } from "@/lib/toast";
import { btn } from "@/lib/ui/buttonStyles";
import { useSingleFlight } from "@/lib/ui/useSingleFlight";

/** A geometry edit in progress: the route whose points are being re-picked. */
export type EditingGeometry = Pick<
  AdminRouteDetail,
  "track_id" | "name" | "from_station" | "to_station" | "intended_backtracking" | "has_backtracking"
>;

const EMPTY_FORM: SaveRouteData = {
  name: "",
  other_names: [],
  from_station: "",
  to_station: "",
  description: "",
  // Default to Regular — the overwhelming majority of routes, saves a click
  usage_type: 0,
  usage_tags: [],
  link: "",
  link_name: "",
  intended_backtracking: false,
  closed: false,
  closed_on: "",
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
  /** Called with the route as stored once a new geometry is saved; the sidebar ends the edit and clears the form. */
  onGeometryEditComplete?: (route: AdminRouteDetail) => void;
  onCancelGeometryEdit?: () => void;
  suggestions?: RouteSuggestions;
  onSuggestionsChanged?: () => void;
}

export default function AdminCreateRouteTab({
  coordinates,
  onCoordinatesChange,
  previewRoute,
  onSaveRoute,
  editingGeometry,
  onGeometryEditComplete,
  onCancelGeometryEdit,
  suggestions = NO_ROUTE_SUGGESTIONS,
  onSuggestionsChanged,
}: AdminCreateRouteTabProps) {
  const { showSuccess } = useToast();
  const region = useRegion();
  const isPreviewMode = previewRoute !== null;
  const { busy: isSaving, run } = useSingleFlight();

  const [createForm, setCreateForm] = useState(EMPTY_FORM);

  // Users' partial rides on the route being re-picked, read as the re-pick starts
  // (fresh: a duplicate's are cloned after its detail was returned). Kept with
  // the route it counts, so another route's count never shows meanwhile.
  const editingTrackId = editingGeometry?.track_id ?? null;
  const [partialRides, setPartialRides] = useState<{ trackId: number; count: number } | null>(null);
  useEffect(() => {
    // A count from an earlier edit of the same route may be stale (its save can
    // log or delete the rides), so none shows until this one's arrives
    setPartialRides(null);
    if (editingTrackId === null) return;
    let cancelled = false;
    fetchPartialRideCount(editingTrackId)
      .then((count) => !cancelled && setPartialRides({ trackId: editingTrackId, count }))
      // Without the count there is no warning; the save itself is unaffected
      .catch((error: unknown) => console.error("Failed to count partial rides:", error));
    return () => {
      cancelled = true;
    };
  }, [editingTrackId]);

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

      // A newly created route may introduce new tags or names; refresh the suggestions.
      onSuggestionsChanged?.();
    });
  };

  const handleSaveGeometry = async () => {
    if (!editingGeometry || !previewRoute) return;
    await run("update the route geometry", async () => {
      // With a track id, saveRailwayRoute updates the geometry and ignores the metadata
      const route = unwrap(
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
      onGeometryEditComplete?.(route);
    });
  };

  const isEditMode = editingGeometry !== null;
  const editingTitle = editingGeometry && routeTitle(editingGeometry, region.id);
  // Warned about before the save, which would flag it (`has_backtracking`) for the
  // "Unintended backtracking" list. Silent once the route says it is intended.
  const intendedBacktracking = editingGeometry
    ? editingGeometry.intended_backtracking
    : createForm.intended_backtracking;
  const warnBacktracking = previewRoute?.hasBacktracking === true && !intendedBacktracking;
  // A re-pick of a route that backtracks, before or after, can't place a partial
  // ride's stretch on the new geometry and logs the ride whole
  // (`reprojectCoveredRanges`), which may complete the route for its user
  const ridesLoggedWhole =
    editingGeometry &&
    previewRoute &&
    partialRides?.trackId === editingGeometry.track_id &&
    (editingGeometry.has_backtracking ||
      editingGeometry.intended_backtracking ||
      previewRoute.hasBacktracking === true)
      ? partialRides.count
      : 0;

  return (
    <div className="p-4 overflow-y-auto">
      <h3 className="font-semibold text-gray-900 mb-4">
        {editingTitle
          ? `Edit Route Geometry (${editingTitle.name ?? editingTitle.endpoints})`
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
        {warnBacktracking && (
          <div className="border rounded-md p-3 bg-orange-50 border-orange-200 text-sm text-orange-800">
            This path backtracks. Re-pick a point if that isn't meant to happen
            {isEditMode
              ? "; if it is, tick Intended backtracking on the route after saving."
              : ", or tick Intended backtracking below if it is."}
          </div>
        )}
        {ridesLoggedWhole > 0 && (
          <div
            role="alert"
            className="border rounded-md p-3 bg-red-50 border-red-200 text-sm text-red-800"
          >
            Re-picking this route changes the completion of users' logs: it backtracks, so{" "}
            {ridesLoggedWhole === 1
              ? "the 1 partial ride logged on it can't be placed on the new geometry: it will be logged whole if it still runs along the route, and deleted if not"
              : `the ${ridesLoggedWhole} partial rides logged on it can't be placed on the new geometry: each will be logged whole if it still runs along the route, and deleted if not`}
            . Unchanged geometry leaves them as they are.
          </div>
        )}

        {!isEditMode && (
          <RouteMetadataFields
            value={createForm}
            onChange={setCreateForm}
            idPrefix="route"
            layout="wide"
            suggestions={suggestions}
            withDailyTag
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
                disabled={isSaving || !isPreviewMode || routeMetadataIncomplete(createForm, region)}
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
