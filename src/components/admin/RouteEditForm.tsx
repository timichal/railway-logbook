"use client";

import RouteMetadataFields, {
  type EditRouteData,
  routeMetadataIncomplete,
} from "@/components/admin/RouteMetadataFields";
import Icon from "@/components/ui/Icon";
import type { AdminRouteDetail, RouteSuggestions } from "@/lib/adminRouteActions";
import { useRegion } from "@/lib/regionContext";
import { btn } from "@/lib/ui/buttonStyles";

/** What the form is busy with: each button names its own action while it runs. */
export type RouteEditAction = "save" | "delete" | "duplicate" | "markInvalid";

interface RouteEditFormProps {
  selectedRoute: AdminRouteDetail | null;
  editForm: EditRouteData | null;
  isLoading: boolean;
  busyAction: RouteEditAction | null;
  suggestions: RouteSuggestions;
  onEditFormChange: (form: EditRouteData) => void;
  onSave: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMarkInvalid: () => void;
  onEditGeometry: (route: AdminRouteDetail) => void;
  onToggleUnderRepair: (underRepair: boolean) => void;
  onUnselect: () => void;
}

export default function RouteEditForm({
  selectedRoute,
  editForm,
  isLoading,
  busyAction,
  suggestions,
  onEditFormChange,
  onSave,
  onDelete,
  onDuplicate,
  onMarkInvalid,
  onEditGeometry,
  onToggleUnderRepair,
  onUnselect,
}: RouteEditFormProps) {
  const region = useRegion();
  const underRepair = selectedRoute?.under_repair === true;
  // As stored, not as ticked in the form: what the route is until Save
  const closed = selectedRoute?.closed === true;
  const incomplete = !editForm || routeMetadataIncomplete(editForm, region.hasRouteNames);

  if (!selectedRoute) {
    return (
      <div
        style={{ width: "250px" }}
        className="overflow-y-auto flex-shrink-0 p-4 text-center text-gray-500"
      >
        {isLoading ? "Loading route…" : "Select a route to edit"}
      </div>
    );
  }

  if (!editForm) {
    return null;
  }

  return (
    <div style={{ width: "250px" }} className="overflow-y-auto flex-shrink-0">
      <div className="p-4">
        {/* Header */}
        <div className="mb-4 flex justify-between items-center">
          <h4 className="font-semibold text-gray-900">Edit Route</h4>
          <button type="button" onClick={onUnselect} className={btn("outline", "sm")}>
            Unselect
          </button>
        </div>

        <div className="space-y-4">
          {/* A closed route is never recalculated, so an invalid one has nothing to
              fix and can't be under repair: it says why its geometry stays put */}
          {closed && (
            <div className="border rounded-md p-3 bg-gray-50 border-gray-200">
              <h3 className="text-sm font-medium text-gray-800">Closed line</h3>
              <p className="mt-1 text-xs text-gray-600">
                Not recalculated: the geometry stays as it is.
                {selectedRoute.is_valid === false && " It was invalid when last checked."}
              </p>
            </div>
          )}

          {/* Invalid Route Alert — violet variant for routes flagged under repair */}
          {selectedRoute.is_valid === false && !closed && (
            <div
              className={`border rounded-md p-3 ${
                underRepair ? "bg-violet-50 border-violet-200" : "bg-red-50 border-red-200"
              }`}
            >
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <Icon
                    name="errorCircle"
                    className={`h-5 w-5 ${underRepair ? "text-violet-400" : "text-red-400"}`}
                  />
                </div>
                <div className="ml-3">
                  <h3
                    className={`text-sm font-medium ${
                      underRepair ? "text-violet-800" : "text-red-800"
                    }`}
                  >
                    {underRepair ? "Under Repair" : "Invalid Route"}
                  </h3>
                  {selectedRoute.error_message && (
                    <div
                      className={`mt-2 text-sm ${underRepair ? "text-violet-700" : "text-red-700"}`}
                    >
                      <p className="mt-1 font-mono text-xs">{selectedRoute.error_message}</p>
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onToggleUnderRepair(!underRepair)}
                disabled={isLoading}
                className={`${btn("repair", "md")} mt-3 w-full`}
              >
                {underRepair ? "Unmark as under repair" : "Mark as under repair"}
              </button>
            </div>
          )}

          <RouteMetadataFields
            value={editForm}
            onChange={onEditFormChange}
            idPrefix="edit"
            layout="narrow"
            withLineClass
            suggestions={suggestions}
          />

          {/* Action Buttons */}
          <div className="pt-4 border-t border-gray-200 space-y-2">
            <button
              type="button"
              onClick={onSave}
              disabled={isLoading || incomplete}
              className={`${btn("primary", "md")} w-full`}
            >
              {busyAction === "save" ? "Saving..." : "Save Metadata"}
            </button>

            <button
              type="button"
              onClick={() => onEditGeometry(selectedRoute)}
              disabled={isLoading}
              className={`${btn("success", "md")} w-full`}
            >
              Edit Route Geometry
            </button>

            <button
              type="button"
              onClick={onDelete}
              disabled={isLoading}
              className={`${btn("danger", "md")} w-full`}
            >
              {busyAction === "delete" ? "Deleting..." : "Delete Route"}
            </button>

            <button
              type="button"
              onClick={onDuplicate}
              disabled={isLoading}
              className={`${btn("neutral", "md")} w-full`}
            >
              {busyAction === "duplicate" ? "Duplicating..." : "Duplicate Route"}
            </button>

            {/* One way: a route becomes valid again only by a geometry re-pick or a
                recalculation. Not on a closed one, which is never recalculated. */}
            {selectedRoute.is_valid !== false && !closed && (
              <button
                type="button"
                onClick={onMarkInvalid}
                disabled={isLoading}
                className={`${btn("outlineDanger", "md")} w-full`}
              >
                {busyAction === "markInvalid" ? "Marking..." : "Mark Route as Invalid"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
