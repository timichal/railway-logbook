"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminCreateRouteTab, {
  type CreateFormCoordinates,
  type EditingGeometry,
} from "@/components/admin/AdminCreateRouteTab";
import AdminNotesTab from "@/components/admin/AdminNotesTab";
import AdminRoutesTab from "@/components/admin/AdminRoutesTab";
import AdminScenicTab, { type EditingScenicLine } from "@/components/admin/AdminScenicTab";
import { actionErrorMessage, unwrap } from "@/lib/actionResult";
import {
  type AdminRouteDetail,
  getFrequencyTags,
  getRailwayRoute,
  type SaveRouteData,
} from "@/lib/adminRouteActions";
import type { PathPreview } from "@/lib/map/hooks/useRoutePreview";
import { useRegion } from "@/lib/regionContext";
import { useToast } from "@/lib/toast";
import { tabBtn } from "@/lib/ui/buttonStyles";

export type AdminTab = "routes" | "create" | "scenic" | "notes";

interface AdminSidebarProps {
  /**
   * The open tab, held by the page: the map behaves differently on the Scenic tab
   * (routes hidden), and the mobile drawer unmounts this component, which would
   * otherwise reopen on the routes tab mid-pick.
   */
  selectedTab: AdminTab;
  onSelectedTabChange: (tab: AdminTab) => void;
  selectedRouteId?: number | null;
  /** The selected route's detail, loaded by the page (the map reads it too). */
  selectedRoute: AdminRouteDetail | null;
  selectedRouteLoading: boolean;
  onSelectedRouteChange: React.Dispatch<React.SetStateAction<AdminRouteDetail | null>>;
  /** Re-reads the selected route after a save; resolves the detail, or null if superseded. */
  onReloadSelectedRoute: () => Promise<AdminRouteDetail | null>;
  /** `focus` flies the map to the route once it has loaded. */
  onRouteSelect?: (routeId: number | null, options?: { focus?: boolean }) => void;
  /** The create form's points. Owned by the page, which fills them from map clicks. */
  createFormCoordinates: CreateFormCoordinates;
  onCreateFormCoordinatesChange: React.Dispatch<React.SetStateAction<CreateFormCoordinates>>;
  /** The geometry edit in progress, also owned by the page (the map hides routes during it). */
  editingGeometry: EditingGeometry | null;
  onEditingGeometryChange: (editing: EditingGeometry | null) => void;
  previewRoute: PathPreview | null;
  onSaveRoute?: (routeData: SaveRouteData) => Promise<boolean>;
  /** Clears the create form's points and the preview drawn from them. */
  onFormReset: () => void;
  onRouteDeleted?: () => void;
  onRouteUpdated?: () => void;
  onRouteFocus?: (geometry: string) => void;
  sidebarWidth?: number | null;
  onFocusNote?: (coordinate: [number, number]) => void;
  onNoteChanged?: () => void;
  notesRefreshSignal?: number;
  showError?: (message: string) => void;
  editingScenicLine: EditingScenicLine | null;
  onEditingScenicLineChange: (editing: EditingScenicLine | null) => void;
  selectedScenicLineId: number | null;
  onScenicLineSelect: (id: number | null) => void;
  onScenicLinesChanged: () => void;
}

export default function AdminSidebar({
  // Already resolved by the page: a route's geometry edit is always on the create tab
  selectedTab: activeTab,
  onSelectedTabChange,
  selectedRouteId,
  selectedRoute,
  selectedRouteLoading,
  onSelectedRouteChange,
  onReloadSelectedRoute,
  onRouteSelect,
  createFormCoordinates,
  onCreateFormCoordinatesChange,
  editingGeometry,
  onEditingGeometryChange,
  previewRoute,
  onSaveRoute,
  onFormReset,
  onRouteDeleted,
  onRouteUpdated,
  onRouteFocus,
  sidebarWidth,
  onFocusNote,
  onNoteChanged,
  notesRefreshSignal,
  showError: showErrorProp,
  editingScenicLine,
  onEditingScenicLineChange,
  selectedScenicLineId,
  onScenicLineSelect,
  onScenicLinesChanged,
}: AdminSidebarProps) {
  const { showError: showErrorToast } = useToast();
  const region = useRegion();
  const showError = showErrorProp || showErrorToast;
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  // Read after an await, to tell whether the edit that asked is still the current one.
  const editingGeometryRef = useRef(editingGeometry);
  editingGeometryRef.current = editingGeometry;
  // Bumped per edit started, so a cancelled edit's load cannot land in a new edit of
  // the same route.
  const editRequestRef = useRef(0);

  // Load the in-use frequency tags for autocomplete, and keep them fresh after edits.
  const loadTags = useCallback(async () => {
    try {
      setAvailableTags(unwrap(await getFrequencyTags()));
    } catch (error) {
      console.error("Error loading frequency tags:", error);
    }
  }, []);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  // Switching tabs abandons whatever was being picked on the one left behind — the
  // points, a route's geometry edit (it would otherwise keep the routes hidden behind
  // a tab no longer on screen); the page drops the scenic tab's own state likewise.
  const switchTab = (tab: AdminTab) => {
    if (tab === activeTab) return;
    onFormReset();
    if (editingGeometryRef.current) onEditingGeometryChange(null);
    if (tab !== "routes") onRouteSelect?.(null);
    onSelectedTabChange(tab);
  };

  // Handle edit geometry button click
  const handleEditGeometry = useCallback(
    async (trackId: number) => {
      const request = ++editRequestRef.current;
      onEditingGeometryChange({ trackId, routeInfo: null });
      onSelectedTabChange("create");

      // Fetch the route details to get starting_coordinate and ending_coordinate
      try {
        const routeDetail = unwrap(await getRailwayRoute(trackId));
        // Cancelled (and perhaps restarted), or the region switched, while the
        // route was loading.
        if (request !== editRequestRef.current || editingGeometryRef.current?.trackId !== trackId)
          return;

        onEditingGeometryChange({
          trackId,
          routeInfo: {
            from_station: routeDetail.from_station,
            to_station: routeDetail.to_station,
          },
        });

        // Prefill the stored points — unless a point was picked on the map while the
        // route loaded, which is the admin's choice and not to be overwritten.
        const { starting_coordinate, ending_coordinate } = routeDetail;
        onCreateFormCoordinatesChange((prev) =>
          prev.startingCoordinate || prev.endingCoordinate
            ? prev
            : { startingCoordinate: starting_coordinate, endingCoordinate: ending_coordinate },
        );
      } catch (error) {
        // Superseded: a newer edit (or none) owns the tab now, and nobody is
        // waiting on this one.
        if (request !== editRequestRef.current || editingGeometryRef.current?.trackId !== trackId)
          return;
        console.error("Error fetching route details for geometry edit:", error);
        // With no route to re-pick (deleted in another tab, session gone), staying
        // in edit mode would only keep the map's routes hidden behind a save that
        // is bound to fail again.
        onEditingGeometryChange(null);
        showError(`Failed to load route details: ${actionErrorMessage(error)}`);
      }
    },
    [onEditingGeometryChange, onCreateFormCoordinatesChange, onSelectedTabChange, showError],
  );

  // Ends a geometry edit, whether saved or cancelled: the form is cleared once, here.
  const endGeometryEdit = useCallback(() => {
    onEditingGeometryChange(null);
    onFormReset();
    onSelectedTabChange("routes");
  }, [onEditingGeometryChange, onFormReset, onSelectedTabChange]);

  // Handle cancel geometry edit
  const handleCancelGeometryEdit = useCallback(() => {
    endGeometryEdit();
    // Unselect the route
    onRouteSelect?.(null);
  }, [endGeometryEdit, onRouteSelect]);

  return (
    <div
      style={sidebarWidth != null ? { width: `${sidebarWidth}px` } : undefined}
      className="bg-surface border-r border-gray-200 flex flex-col flex-shrink-0"
    >
      {/* Tab Headers */}
      <div className="flex border-b border-gray-200">
        <button
          type="button"
          onClick={() => switchTab("routes")}
          className={tabBtn(activeTab === "routes")}
        >
          Railway Routes
        </button>
        <button
          type="button"
          onClick={() => switchTab("create")}
          className={tabBtn(activeTab === "create")}
        >
          Create New
        </button>
        {/* Only where the user map can show what is drawn here */}
        {region.hasScenicHighlight && (
          <button
            type="button"
            onClick={() => switchTab("scenic")}
            className={tabBtn(activeTab === "scenic")}
          >
            Scenic
          </button>
        )}
        <button
          type="button"
          onClick={() => switchTab("notes")}
          className={tabBtn(activeTab === "notes")}
        >
          Notes
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "routes" && (
          <AdminRoutesTab
            selectedRouteId={selectedRouteId}
            selectedRoute={selectedRoute}
            selectedRouteLoading={selectedRouteLoading}
            onSelectedRouteChange={onSelectedRouteChange}
            onReloadSelectedRoute={onReloadSelectedRoute}
            onRouteSelect={onRouteSelect}
            onRouteDeleted={onRouteDeleted}
            onRouteUpdated={onRouteUpdated}
            onEditGeometry={handleEditGeometry}
            onRouteFocus={onRouteFocus}
            availableTags={availableTags}
            onTagsChanged={loadTags}
          />
        )}

        {activeTab === "create" && (
          <AdminCreateRouteTab
            startingCoordinate={createFormCoordinates.startingCoordinate}
            endingCoordinate={createFormCoordinates.endingCoordinate}
            onStartingCoordinateChange={(coord) =>
              onCreateFormCoordinatesChange((prev) => ({ ...prev, startingCoordinate: coord }))
            }
            onEndingCoordinateChange={(coord) =>
              onCreateFormCoordinatesChange((prev) => ({ ...prev, endingCoordinate: coord }))
            }
            previewRoute={previewRoute}
            onSaveRoute={onSaveRoute}
            editingGeometryForTrackId={editingGeometry?.trackId ?? null}
            editingRouteInfo={editingGeometry?.routeInfo ?? null}
            onGeometryEditComplete={() => {
              endGeometryEdit();
              onRouteUpdated?.();
              // The route stays selected, and the re-pick changed its length and
              // validity: the banner and the map's length box must follow.
              onReloadSelectedRoute().catch((error) => {
                console.error("Error reloading route after geometry edit:", error);
                showError(`Route saved, but reloading it failed: ${actionErrorMessage(error)}`);
              });
            }}
            onCancelGeometryEdit={handleCancelGeometryEdit}
            availableTags={availableTags}
            onTagsChanged={loadTags}
          />
        )}

        {activeTab === "scenic" && (
          <AdminScenicTab
            createFormCoordinates={createFormCoordinates}
            onCreateFormCoordinatesChange={onCreateFormCoordinatesChange}
            previewRoute={previewRoute}
            onFormReset={onFormReset}
            editing={editingScenicLine}
            onEditingChange={onEditingScenicLineChange}
            selectedId={selectedScenicLineId}
            onSelect={onScenicLineSelect}
            onFocusGeometry={(geometry) => onRouteFocus?.(geometry)}
            onChanged={onScenicLinesChanged}
          />
        )}

        {activeTab === "notes" && (
          <AdminNotesTab
            onFocusNote={onFocusNote}
            onNoteChanged={onNoteChanged}
            refreshSignal={notesRefreshSignal}
          />
        )}
      </div>
    </div>
  );
}
