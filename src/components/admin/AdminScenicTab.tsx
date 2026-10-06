"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CreateFormCoordinates } from "@/components/admin/AdminCreateRouteTab";
import PickedPointField from "@/components/admin/PickedPointField";
import { INPUT, LABEL } from "@/components/admin/RouteMetadataFields";
import { actionErrorMessage, unwrap } from "@/lib/actionResult";
import {
  type AdminScenicLine,
  createScenicLine,
  deleteScenicLine,
  getScenicLines,
  updateScenicLineGeometry,
  updateScenicLineNames,
} from "@/lib/adminScenicLineActions";
import { handleJunctionShortcut } from "@/lib/junctionShortcut";
import type { PathPreview } from "@/lib/map/hooks/useRoutePreview";
import { useRegionId } from "@/lib/regionContext";
import { ConfirmDialog, useToast } from "@/lib/toast";
import { btn, optionRow } from "@/lib/ui/buttonStyles";

/** A scenic line whose geometry is being re-picked. */
export interface EditingScenicLine {
  id: number;
  from_station: string;
  to_station: string;
}

interface AdminScenicTabProps {
  /** The picked points, owned by the page (map clicks fill them) and shared with the route form. */
  createFormCoordinates: CreateFormCoordinates;
  onCreateFormCoordinatesChange: React.Dispatch<React.SetStateAction<CreateFormCoordinates>>;
  /** The path between the picked points; what a save stores. */
  previewRoute: PathPreview | null;
  /** Clears the picked points, and with them the preview. */
  onFormReset: () => void;
  /** The geometry re-pick in progress, owned by the page so it survives the mobile drawer. */
  editing: EditingScenicLine | null;
  onEditingChange: (editing: EditingScenicLine | null) => void;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onFocusGeometry: (geometry: string) => void;
  /** A line was saved or deleted: the map refreshes its scenic tiles. */
  onChanged: () => void;
}

/**
 * The admin's scenic lines: a form to draw one (two points picked on the map, the
 * same way a route is, plus From and To) and the region's list, where a line is
 * renamed, re-picked or deleted.
 *
 * While this tab is open the map hides the routes (`scenicMode` on AdminMap), so a
 * click anywhere on the track picks a point.
 */
export default function AdminScenicTab({
  createFormCoordinates,
  onCreateFormCoordinatesChange,
  previewRoute,
  onFormReset,
  editing,
  onEditingChange,
  selectedId,
  onSelect,
  onFocusGeometry,
  onChanged,
}: AdminScenicTabProps) {
  const regionId = useRegionId();
  const { showError, showSuccess } = useToast();
  const [lines, setLines] = useState<AdminScenicLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [invalidOnly, setInvalidOnly] = useState(false);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  // The selected line's names as being edited, filled once per line selected.
  const [names, setNames] = useState<{ from: string; to: string } | null>(null);
  const [namesForId, setNamesForId] = useState<number | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  // A second click must not save twice: the ref is set synchronously, the state
  // that disables the button only on the next render.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  // Bumped per load, so a slower reply to an earlier one (another region's, after
  // a switch) cannot land over the newest list.
  const loadRequestRef = useRef(0);

  const selected = lines.find((line) => line.id === selectedId) ?? null;
  if ((selected?.id ?? null) !== namesForId) {
    setNamesForId(selected?.id ?? null);
    setNames(selected ? { from: selected.from_station, to: selected.to_station } : null);
  }

  const loadLines = async () => {
    const request = ++loadRequestRef.current;
    setLoading(true);
    try {
      const loaded = unwrap(await getScenicLines(regionId));
      if (request === loadRequestRef.current) setLines(loaded);
    } catch (error) {
      if (request === loadRequestRef.current) {
        showError(`Failed to load scenic lines: ${actionErrorMessage(error)}`);
      }
    } finally {
      if (request === loadRequestRef.current) setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadLines is redefined every render; the region is what should reload the list (plus the initial mount).
  useEffect(() => {
    loadLines();
  }, [regionId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return lines.filter(
      (line) =>
        (!invalidOnly || !line.is_valid) &&
        (!query ||
          line.from_station.toLowerCase().includes(query) ||
          line.to_station.toLowerCase().includes(query)),
    );
  }, [lines, search, invalidOnly]);
  const invalidCount = lines.filter((line) => !line.is_valid).length;

  /** Runs one save/delete, guarded against a double click; resolves whether it succeeded. */
  const run = async (what: string, action: () => Promise<void>): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
      return true;
    } catch (error) {
      console.error(`Error: ${what}:`, error);
      showError(`Failed to ${what}: ${actionErrorMessage(error)}`);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    const preview = previewRoute;
    if (!preview) return;
    const from = newFrom.trim();
    const to = newTo.trim();
    const saved = await run("save the scenic line", async () => {
      const id = unwrap(
        await createScenicLine(
          from,
          to,
          preview.coordinates,
          preview.startCoordinate,
          preview.endCoordinate,
        ),
      );
      onFormReset();
      setNewFrom("");
      setNewTo("");
      onChanged();
      await loadLines();
      onSelect(id);
    });
    if (saved) showSuccess(`Scenic line "${from} ⟷ ${to}" saved`);
  };

  const handleSaveGeometry = async () => {
    const preview = previewRoute;
    if (!editing || !preview) return;
    const id = editing.id;
    const saved = await run("save the new geometry", async () => {
      unwrap(
        await updateScenicLineGeometry(
          id,
          preview.coordinates,
          preview.startCoordinate,
          preview.endCoordinate,
        ),
      );
      onEditingChange(null);
      onFormReset();
      onChanged();
      await loadLines();
    });
    if (saved) showSuccess("Scenic line geometry updated");
  };

  const cancelGeometryEdit = () => {
    onEditingChange(null);
    onFormReset();
  };

  const startGeometryEdit = (line: AdminScenicLine) => {
    onEditingChange({ id: line.id, from_station: line.from_station, to_station: line.to_station });
    // The stored points, so the current path shows until one of them is re-picked
    onCreateFormCoordinatesChange({
      startingCoordinate: line.starting_coordinate,
      endingCoordinate: line.ending_coordinate,
    });
  };

  const handleSaveNames = async () => {
    if (!selected || !names) return;
    const id = selected.id;
    const saved = await run("rename the scenic line", async () => {
      unwrap(await updateScenicLineNames(id, names.from, names.to));
      onChanged();
      await loadLines();
    });
    if (saved) showSuccess("Scenic line renamed");
  };

  const confirmDelete = async () => {
    setDeleteConfirmOpen(false);
    if (!selected) return;
    const { id, from_station, to_station } = selected;
    const deleted = await run("delete the scenic line", async () => {
      unwrap(await deleteScenicLine(id));
      onSelect(null);
      onChanged();
      await loadLines();
    });
    if (deleted) showSuccess(`Scenic line "${from_station} ⟷ ${to_station}" deleted`);
  };

  const picked = (
    <>
      <PickedPointField
        id="scenic-starting-point"
        label="Starting Point *"
        coordinate={createFormCoordinates.startingCoordinate}
        locked={previewRoute !== null}
        onClear={() =>
          onCreateFormCoordinatesChange((prev) => ({ ...prev, startingCoordinate: null }))
        }
      />
      <PickedPointField
        id="scenic-ending-point"
        label="Ending Point *"
        coordinate={createFormCoordinates.endingCoordinate}
        locked={previewRoute !== null}
        onClear={() =>
          onCreateFormCoordinatesChange((prev) => ({ ...prev, endingCoordinate: null }))
        }
      />
    </>
  );

  if (editing) {
    return (
      <div className="p-4 space-y-4">
        <h3 className="font-semibold text-gray-900">
          Edit Scenic Line Geometry ({editing.from_station} ⟷ {editing.to_station})
        </h3>
        <p className="text-sm text-gray-600">
          Clear a point and click the track to re-pick it. The path is previewed on the map.
        </p>
        {picked}
        <div className="pt-4 border-t border-gray-200 space-y-2">
          <button
            type="button"
            onClick={cancelGeometryEdit}
            className={`${btn("neutral", "md")} w-full`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveGeometry}
            disabled={!previewRoute || busy}
            className={`${btn("success", "md")} w-full`}
          >
            {busy ? "Saving…" : "Save New Geometry"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title="Delete Scenic Line"
        message={
          selected
            ? `Delete the scenic line "${selected.from_station} ⟷ ${selected.to_station}"?\n\nThis cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />

      <div className="p-4 space-y-4">
        <h3 className="font-semibold text-gray-900">New Scenic Line</h3>
        <p className="text-sm text-gray-600">
          Click the track on the map to set the start and end of the scenic stretch. Routes are
          hidden while this tab is open, so any point on the track can be picked.
        </p>
        {picked}
        <div>
          <label htmlFor="scenic-from" className={LABEL}>
            From *
          </label>
          <input
            id="scenic-from"
            type="text"
            value={newFrom}
            onChange={(e) => setNewFrom(e.target.value)}
            onKeyDown={(e) => handleJunctionShortcut(e, setNewFrom)}
            className={INPUT}
            placeholder="Where the scenic stretch starts"
          />
        </div>
        <div>
          <label htmlFor="scenic-to" className={LABEL}>
            To *
          </label>
          <input
            id="scenic-to"
            type="text"
            value={newTo}
            onChange={(e) => setNewTo(e.target.value)}
            onKeyDown={(e) => handleJunctionShortcut(e, setNewTo)}
            className={INPUT}
            placeholder="Where it ends"
          />
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={busy || !previewRoute || !newFrom.trim() || !newTo.trim()}
          className={`${btn("success", "md")} w-full`}
        >
          {busy ? "Saving…" : "Save Scenic Line"}
        </button>
      </div>

      <div className="border-t border-gray-200">
        <div className="p-4 space-y-2">
          <h3 className="font-semibold text-gray-900">Scenic Lines ({lines.length})</h3>
          {invalidCount > 0 && (
            <label className="flex items-center text-sm">
              <input
                type="checkbox"
                checked={invalidOnly}
                onChange={(e) => setInvalidOnly(e.target.checked)}
                className="mr-2"
              />
              <span className="text-gray-700">Invalid only ({invalidCount})</span>
            </label>
          )}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by from or to..."
            className={INPUT}
          />
        </div>

        {loading && lines.length === 0 ? (
          <div className="p-4 text-center text-gray-500">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500">
            {lines.length === 0 ? "No scenic lines in this region yet." : "No match."}
          </div>
        ) : (
          <div className="divide-y divide-gray-100 border-t border-gray-100">
            {filtered.map((line) => (
              <div key={line.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(line.id === selectedId ? null : line.id);
                    if (line.id !== selectedId) onFocusGeometry(line.geometry);
                  }}
                  className={`${optionRow(line.id === selectedId)} p-3 flex items-baseline gap-2`}
                >
                  <span className="font-medium text-sm text-gray-900 truncate flex-1">
                    {line.from_station} ⟷ {line.to_station}
                  </span>
                  {!line.is_valid && (
                    <span className="text-xs font-medium text-red-700 flex-shrink-0">Invalid</span>
                  )}
                  <span className="text-xs text-gray-500 flex-shrink-0">
                    {line.length_km.toFixed(1)} km
                  </span>
                </button>

                {line.id === selectedId && names && (
                  <div className="px-3 pb-3 space-y-3">
                    {!line.is_valid && (
                      <div className="border rounded-md p-3 bg-red-50 border-red-200">
                        <div className="text-sm font-medium text-red-800">Invalid scenic line</div>
                        {line.error_message && (
                          <p className="mt-1 font-mono text-xs text-red-700">
                            {line.error_message}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-red-700">
                          The map keeps drawing its last geometry. Re-pick it to fix.
                        </p>
                      </div>
                    )}
                    <div>
                      <label htmlFor="scenic-edit-from" className={LABEL}>
                        From *
                      </label>
                      <input
                        id="scenic-edit-from"
                        type="text"
                        value={names.from}
                        onChange={(e) => setNames({ ...names, from: e.target.value })}
                        onKeyDown={(e) =>
                          handleJunctionShortcut(e, (from) => setNames({ ...names, from }))
                        }
                        className={INPUT}
                      />
                    </div>
                    <div>
                      <label htmlFor="scenic-edit-to" className={LABEL}>
                        To *
                      </label>
                      <input
                        id="scenic-edit-to"
                        type="text"
                        value={names.to}
                        onChange={(e) => setNames({ ...names, to: e.target.value })}
                        onKeyDown={(e) =>
                          handleJunctionShortcut(e, (to) => setNames({ ...names, to }))
                        }
                        className={INPUT}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={handleSaveNames}
                        disabled={
                          busy ||
                          !names.from.trim() ||
                          !names.to.trim() ||
                          (names.from === line.from_station && names.to === line.to_station)
                        }
                        className={btn("primary", "sm")}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => startGeometryEdit(line)}
                        disabled={busy}
                        className={btn("success", "sm")}
                      >
                        Geometry
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmOpen(true)}
                        disabled={busy}
                        className={btn("danger", "sm")}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
