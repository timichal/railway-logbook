"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { EditingScenicLine } from "@/components/admin/AdminCreateScenicTab";
import AdminList, { usePagedList } from "@/components/admin/AdminList";
import TextField from "@/components/admin/TextField";
import Icon from "@/components/ui/Icon";
import { actionErrorMessage, unwrap } from "@/lib/actionResult";
import {
  type AdminScenicLine,
  deleteScenicLine,
  getScenicLines,
  updateScenicLineNames,
} from "@/lib/adminScenicLineActions";
import { isPathfinderChange } from "@/lib/pathfinderChange";
import { useRegionId } from "@/lib/regionContext";
import { foldForSearch } from "@/lib/searchText";
import type { RouteBounds } from "@/lib/shared/types";
import { JUNCTION_SHORTCUT } from "@/lib/textShortcut";
import { ConfirmDialog, useToast } from "@/lib/toast";
import { compareByEndpoints } from "@/lib/ui/adminListSort";
import { btn } from "@/lib/ui/buttonStyles";
import { useSingleFlight } from "@/lib/ui/useSingleFlight";

const scenicLineKey = (line: AdminScenicLine) => line.id;

const isPathfinderChangeLine = (line: AdminScenicLine) =>
  !line.is_valid && isPathfinderChange(line.error_message);

interface AdminScenicLinesTabProps {
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onFocusBounds: (bounds: RouteBounds) => void;
  /** Edit Geometry: the sidebar takes the line to the New Scenic tab for its re-pick. */
  onEditGeometry: (
    line: EditingScenicLine,
    points: Pick<AdminScenicLine, "starting_coordinate" | "ending_coordinate">,
  ) => void;
  /** A line was renamed or deleted: the map refreshes its scenic tiles. */
  onChanged: () => void;
  /** Heads the list: the Routes / Scenic switch. */
  toolbar?: ReactNode;
}

/**
 * The Routes tab's scenic half: the region's scenic lines on the left, the selected
 * one's form on the right, where it is renamed, re-picked or deleted. New ones are
 * drawn in the New Scenic tab.
 */
export default function AdminScenicLinesTab({
  selectedId,
  onSelect,
  onFocusBounds,
  onEditGeometry,
  onChanged,
  toolbar,
}: AdminScenicLinesTabProps) {
  const regionId = useRegionId();
  const { showError, showSuccess } = useToast();
  const [lines, setLines] = useState<AdminScenicLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [invalidOnly, setInvalidOnly] = useState(false);
  // TEMPORARY (`pathfinderChange.ts`): the invalid lines the new pathfinder moved
  const [pathfinderChangeOnly, setPathfinderChangeOnly] = useState(false);
  // The selected line's names as being edited, filled once per line selected.
  const [names, setNames] = useState<{ from: string; to: string } | null>(null);
  const [namesForId, setNamesForId] = useState<number | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const { busy, run } = useSingleFlight();
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

  // Sorted here, not by the query — the same order as the routes list. The selected
  // line is always listed: one picked on the map may not match the filter, and its
  // row is where it is edited.
  const filtered = useMemo(() => {
    const query = foldForSearch(search);
    return lines
      .toSorted((a, b) => compareByEndpoints(a, b) || a.id - b.id)
      .filter(
        (line) =>
          line.id === selectedId ||
          ((!invalidOnly || !line.is_valid) &&
            (!pathfinderChangeOnly || isPathfinderChangeLine(line)) &&
            (!query ||
              foldForSearch(line.from_station).includes(query) ||
              foldForSearch(line.to_station).includes(query))),
      );
  }, [lines, search, invalidOnly, pathfinderChangeOnly, selectedId]);
  const paged = usePagedList(
    filtered,
    `${regionId}|${search}|${invalidOnly}|${pathfinderChangeOnly}`,
    scenicLineKey,
    selectedId,
  );
  const invalidCount = useMemo(() => lines.filter((line) => !line.is_valid).length, [lines]);
  const pathfinderChangeCount = useMemo(() => lines.filter(isPathfinderChangeLine).length, [lines]);

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

      <div className="h-full flex">
        <AdminList
          toolbar={toolbar}
          filters={[
            {
              key: "invalid",
              label: "Invalid",
              count: invalidCount,
              checked: invalidOnly,
              onChange: setInvalidOnly,
            },
            {
              key: "pathfinderChange",
              label: "Recalculated",
              count: pathfinderChangeCount,
              checked: pathfinderChangeOnly,
              onChange: setPathfinderChangeOnly,
            },
          ]}
          searchQuery={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search by from or to..."
          noun="scenic line"
          total={lines.length}
          items={paged.items}
          filteredCount={filtered.length}
          currentPage={paged.currentPage}
          totalPages={paged.totalPages}
          onPageChange={paged.setCurrentPage}
          getKey={scenicLineKey}
          selectedKey={selectedId}
          onItemClick={(line) => {
            // As a route's row: a click on the selected one flies back to it
            if (line.id !== selectedId) onSelect(line.id);
            onFocusBounds(line.bounds);
          }}
          renderItem={(line) => (
            <div className="flex items-baseline gap-2">
              <span className="font-medium text-sm text-gray-900 truncate flex-1">
                {line.from_station} ⟷ {line.to_station}
              </span>
              {!line.is_valid && (
                <span className="text-xs font-medium text-red-700 flex-shrink-0">Invalid</span>
              )}
              <span className="text-xs text-gray-500 flex-shrink-0">
                {line.length_km.toFixed(1)} km
              </span>
            </div>
          )}
          isLoading={loading && lines.length === 0}
          emptyText="No scenic lines in this region yet."
        />

        {selected && names ? (
          <div style={{ width: "250px" }} className="overflow-y-auto flex-shrink-0">
            <div className="p-4 space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="font-semibold text-gray-900">Edit Scenic Line</h4>
                <button
                  type="button"
                  onClick={() => onSelect(null)}
                  className={btn("outline", "sm")}
                >
                  Unselect
                </button>
              </div>

              {!selected.is_valid && (
                <div className="border rounded-md p-3 bg-red-50 border-red-200 flex items-start">
                  <Icon name="errorCircle" className="h-5 w-5 text-red-400 flex-shrink-0" />
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800">Invalid Scenic Line</h3>
                    {selected.error_message && (
                      <p className="mt-1 font-mono text-xs text-red-700">
                        {selected.error_message}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-red-700">
                      The map keeps drawing its last geometry. Re-pick it to fix.
                    </p>
                  </div>
                </div>
              )}

              <TextField
                id="scenic-edit-from"
                label="From *"
                value={names.from}
                onChange={(from) => setNames({ ...names, from })}
                shortcut={JUNCTION_SHORTCUT}
              />
              <TextField
                id="scenic-edit-to"
                label="To *"
                value={names.to}
                onChange={(to) => setNames({ ...names, to })}
                shortcut={JUNCTION_SHORTCUT}
              />

              <div className="pt-4 border-t border-gray-200 space-y-2">
                <button
                  type="button"
                  onClick={handleSaveNames}
                  disabled={
                    busy ||
                    !names.from.trim() ||
                    !names.to.trim() ||
                    (names.from === selected.from_station && names.to === selected.to_station)
                  }
                  className={`${btn("primary", "md")} w-full`}
                >
                  Save Names
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onEditGeometry(
                      {
                        id: selected.id,
                        from_station: selected.from_station,
                        to_station: selected.to_station,
                      },
                      selected,
                    )
                  }
                  disabled={busy}
                  className={`${btn("success", "md")} w-full`}
                >
                  Edit Geometry
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={busy}
                  className={`${btn("danger", "md")} w-full`}
                >
                  Delete Scenic Line
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{ width: "250px" }}
            className="overflow-y-auto flex-shrink-0 p-4 text-center text-gray-500"
          >
            {selectedId !== null && loading ? "Loading…" : "Select a scenic line to edit"}
          </div>
        )}
      </div>
    </>
  );
}
