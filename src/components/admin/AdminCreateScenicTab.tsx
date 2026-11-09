"use client";

import { useState } from "react";
import PickedPointField from "@/components/admin/PickedPointField";
import TextField from "@/components/admin/TextField";
import { unwrap } from "@/lib/actionResult";
import { createScenicLine, updateScenicLineGeometry } from "@/lib/adminScenicLineActions";
import type { CreateFormCoordinates, PathPreview } from "@/lib/map/hooks/useRoutePreview";
import { JUNCTION_SHORTCUT } from "@/lib/textShortcut";
import { useToast } from "@/lib/toast";
import { btn } from "@/lib/ui/buttonStyles";
import { useSingleFlight } from "@/lib/ui/useSingleFlight";

/** A scenic line whose geometry is being re-picked. */
export interface EditingScenicLine {
  id: number;
  from_station: string;
  to_station: string;
}

interface AdminCreateScenicTabProps {
  /** The picked points, owned by the page (map clicks fill them) and shared with the route form. */
  coordinates: CreateFormCoordinates;
  onCoordinatesChange: React.Dispatch<React.SetStateAction<CreateFormCoordinates>>;
  /** The path between the picked points; a save stores it (found again by the server) unless it backtracks. */
  previewRoute: PathPreview | null;
  /** Clears the picked points, and with them the preview. */
  onFormReset: () => void;
  /** Set while an existing line's geometry is re-picked instead of a line drawn. */
  editing: EditingScenicLine | null;
  /** The new geometry is saved; the sidebar ends the re-pick and clears the form. */
  onGeometryEditComplete: () => void;
  onCancelGeometryEdit: () => void;
  /** A line was saved: the map refreshes its scenic tiles. */
  onChanged: () => void;
}

/**
 * The New Scenic tab: two points picked on the map, the same way a route's are, plus
 * From and To; or, during a geometry re-pick, the points alone. The scenic lines
 * themselves are listed, renamed and deleted in the Routes tab.
 *
 * While it is open the map hides the routes (`scenicMode` on AdminMap), so a click
 * on the track picks a point, except on a scenic line, which the click selects. Its
 * end dots pick their point, as a route's do. During a re-pick the lines take no click.
 */
export default function AdminCreateScenicTab({
  coordinates,
  onCoordinatesChange,
  previewRoute,
  onFormReset,
  editing,
  onGeometryEditComplete,
  onCancelGeometryEdit,
  onChanged,
}: AdminCreateScenicTabProps) {
  const { showSuccess } = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { busy, run } = useSingleFlight();
  // A backtracking path is shown but never saved; the server refuses it too.
  const backtracks = previewRoute?.hasBacktracking === true;
  const savablePreview = backtracks ? null : previewRoute;

  const handleCreate = async () => {
    const preview = savablePreview;
    if (!preview) return;
    const fromStation = from.trim();
    const toStation = to.trim();
    const saved = await run("save the scenic line", async () => {
      unwrap(
        await createScenicLine(
          fromStation,
          toStation,
          preview.startCoordinate,
          preview.endCoordinate,
        ),
      );
      onFormReset();
      setFrom("");
      setTo("");
      onChanged();
    });
    if (saved) showSuccess(`Scenic line "${fromStation} ⟷ ${toStation}" saved`);
  };

  const handleSaveGeometry = async () => {
    const preview = savablePreview;
    if (!editing || !preview) return;
    const id = editing.id;
    const saved = await run("save the new geometry", async () => {
      unwrap(await updateScenicLineGeometry(id, preview.startCoordinate, preview.endCoordinate));
      onChanged();
      onGeometryEditComplete();
    });
    if (saved) showSuccess("Scenic line geometry updated");
  };

  return (
    <div className="p-4 space-y-4">
      <h3 className="font-semibold text-gray-900">
        {editing
          ? `Edit Scenic Line Geometry (${editing.from_station} ⟷ ${editing.to_station})`
          : "New Scenic Line"}
      </h3>
      <p className="text-sm text-gray-600">
        {editing
          ? "Clear a point and click the track to re-pick it. The path is previewed on the map."
          : "Click the track on the map to set the start and end of the scenic stretch. Routes are hidden here, so any point on the track can be picked. A click on an existing scenic line selects it; click one of its violet end dots to start or end at it."}
      </p>

      <PickedPointField
        id="scenic-starting-point"
        label="Starting Point *"
        coordinate={coordinates.startingCoordinate}
        locked={previewRoute !== null}
        onClear={() => onCoordinatesChange((prev) => ({ ...prev, startingCoordinate: null }))}
      />
      <PickedPointField
        id="scenic-ending-point"
        label="Ending Point *"
        coordinate={coordinates.endingCoordinate}
        locked={previewRoute !== null}
        onClear={() => onCoordinatesChange((prev) => ({ ...prev, endingCoordinate: null }))}
      />
      {backtracks && (
        <div className="border rounded-md p-3 bg-red-50 border-red-200 text-sm text-red-800">
          This path backtracks, so it can't be saved as a scenic line. Re-pick a point so the path
          runs straight through.
        </div>
      )}

      {editing ? (
        <div className="pt-4 border-t border-gray-200 space-y-2">
          <button
            type="button"
            onClick={onCancelGeometryEdit}
            disabled={busy}
            className={`${btn("neutral", "md")} w-full`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveGeometry}
            disabled={!savablePreview || busy}
            className={`${btn("success", "md")} w-full`}
          >
            {busy ? "Saving…" : "Save New Geometry"}
          </button>
        </div>
      ) : (
        <>
          <TextField
            id="scenic-from"
            label="From *"
            value={from}
            onChange={setFrom}
            shortcut={JUNCTION_SHORTCUT}
            placeholder="Where the scenic stretch starts"
          />
          <TextField
            id="scenic-to"
            label="To *"
            value={to}
            onChange={setTo}
            shortcut={JUNCTION_SHORTCUT}
            placeholder="Where it ends"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy || !savablePreview || !from.trim() || !to.trim()}
            className={`${btn("success", "md")} w-full`}
          >
            {busy ? "Saving…" : "Save Scenic Line"}
          </button>
        </>
      )}
    </div>
  );
}
