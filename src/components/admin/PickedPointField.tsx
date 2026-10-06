"use client";

import { LABEL } from "@/components/admin/RouteMetadataFields";
import { iconBtn } from "@/lib/ui/buttonStyles";

const formatCoordinate = (coord: [number, number] | null) =>
  coord ? `${coord[1].toFixed(6)}, ${coord[0].toFixed(6)}` : "";

/**
 * One of the two points picked on the admin map — read-only, filled by a click on
 * a railway part, cleared with its ×. Shared by the route and scenic line forms,
 * which pick the same way. `locked` greys it while a preview stands on both points.
 */
export default function PickedPointField({
  id,
  label,
  coordinate,
  locked,
  onClear,
}: {
  id: string;
  label: string;
  coordinate: [number, number] | null;
  locked: boolean;
  onClear: () => void;
}) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          value={formatCoordinate(coordinate)}
          readOnly
          placeholder="Click a railway part on the map"
          disabled={locked}
          className={`flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-fg ${
            locked ? "bg-gray-100 cursor-not-allowed" : "bg-gray-50"
          }`}
        />
        <button
          type="button"
          onClick={onClear}
          className={`${iconBtn("sm", "danger")} self-center`}
          title={`Clear ${label.replace(/ \*$/, "").toLowerCase()}`}
          aria-label={`Clear ${label.replace(/ \*$/, "").toLowerCase()}`}
        >
          ×
        </button>
      </div>
    </div>
  );
}
