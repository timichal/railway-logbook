"use client";

import RouteMetadataFields, {
  type EditRouteData,
  routeMetadataIncomplete,
} from "@/components/admin/RouteMetadataFields";
import type { AdminRouteDetail } from "@/lib/adminRouteActions";
import { useRegion } from "@/lib/regionContext";
import { btn } from "@/lib/ui/buttonStyles";

interface RouteEditFormProps {
  selectedRoute: AdminRouteDetail | null;
  editForm: EditRouteData | null;
  isLoading: boolean;
  availableTags: string[];
  onEditFormChange: (form: EditRouteData) => void;
  onSave: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onEditGeometry: (trackId: number) => void;
  onToggleUnderRepair: (underRepair: boolean) => void;
  onUnselect: () => void;
}

export default function RouteEditForm({
  selectedRoute,
  editForm,
  isLoading,
  availableTags,
  onEditFormChange,
  onSave,
  onDelete,
  onDuplicate,
  onEditGeometry,
  onToggleUnderRepair,
  onUnselect,
}: RouteEditFormProps) {
  const region = useRegion();
  const underRepair = selectedRoute?.under_repair === true;
  const incomplete = !editForm || routeMetadataIncomplete(editForm, region.hasRouteNames);

  if (!selectedRoute) {
    return (
      <div
        style={{ width: "250px" }}
        className="overflow-y-auto flex-shrink-0 p-4 text-center text-gray-500"
      >
        Select a route to edit
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
          {/* Invalid Route Alert — violet variant for routes flagged under repair */}
          {selectedRoute.is_valid === false && (
            <div
              className={`border rounded-md p-3 ${
                underRepair ? "bg-violet-50 border-violet-200" : "bg-red-50 border-red-200"
              }`}
            >
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <svg
                    className={`h-5 w-5 ${underRepair ? "text-violet-400" : "text-red-400"}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
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
            availableTags={availableTags}
          />

          {/* Action Buttons */}
          <div className="pt-4 border-t border-gray-200 space-y-2">
            <button
              type="button"
              onClick={onSave}
              disabled={isLoading || incomplete}
              className={`${btn("primary", "md")} w-full`}
            >
              {isLoading ? "Saving..." : "Save Metadata"}
            </button>

            <button
              type="button"
              onClick={() => onEditGeometry(selectedRoute.track_id)}
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
              {isLoading ? "Deleting..." : "Delete Route"}
            </button>

            <button
              type="button"
              onClick={onDuplicate}
              disabled={isLoading}
              className={`${btn("neutral", "md")} w-full`}
            >
              Duplicate Route
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
