"use client";

import { useCallback, useEffect, useState } from "react";
import AdminCreateRouteTab, { type EditingGeometry } from "@/components/admin/AdminCreateRouteTab";
import AdminNotesTab from "@/components/admin/AdminNotesTab";
import AdminRoutesTab from "@/components/admin/AdminRoutesTab";
import AdminScenicTab, { type EditingScenicLine } from "@/components/admin/AdminScenicTab";
import { actionErrorMessage, unwrap } from "@/lib/actionResult";
import {
  type AdminRouteDetail,
  getFrequencyTags,
  type SaveRouteData,
} from "@/lib/adminRouteActions";
import type { CreateFormCoordinates, PathPreview } from "@/lib/map/hooks/useRoutePreview";
import { useRegion } from "@/lib/regionContext";
import { useToast } from "@/lib/toast";
import { tabBtn } from "@/lib/ui/buttonStyles";

export type AdminTab = "routes" | "create" | "scenic" | "notes";

const TABS: { id: AdminTab; label: string }[] = [
  { id: "routes", label: "Railway Routes" },
  { id: "create", label: "Create New" },
  { id: "scenic", label: "Scenic" },
  { id: "notes", label: "Notes" },
];

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
  onSaveRoute?: (routeData: SaveRouteData) => Promise<void>;
  /** Clears the create form's points and the preview drawn from them. */
  onFormReset: () => void;
  /** A route was created, changed or deleted: the map's route tiles are stale. */
  onRoutesChanged: () => void;
  onRouteFocus?: (geometry: string) => void;
  sidebarWidth?: string | null;
  onFocusNote?: (coordinate: [number, number]) => void;
  onNoteChanged?: () => void;
  notesRefreshSignal?: number;
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
  onRoutesChanged,
  onRouteFocus,
  sidebarWidth,
  onFocusNote,
  onNoteChanged,
  notesRefreshSignal,
  editingScenicLine,
  onEditingScenicLineChange,
  selectedScenicLineId,
  onScenicLineSelect,
  onScenicLinesChanged,
}: AdminSidebarProps) {
  const { showError } = useToast();
  const region = useRegion();
  const [availableTags, setAvailableTags] = useState<string[]>([]);

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
    if (editingGeometry) onEditingGeometryChange(null);
    if (tab !== "routes") onRouteSelect?.(null);
    onSelectedTabChange(tab);
  };

  // Only the selected route offers Edit Geometry, so its loaded detail has the
  // stored points to start the re-pick from.
  const handleEditGeometry = (route: AdminRouteDetail) => {
    onEditingGeometryChange(route);
    onCreateFormCoordinatesChange({
      startingCoordinate: route.starting_coordinate,
      endingCoordinate: route.ending_coordinate,
    });
    onSelectedTabChange("create");
  };

  // Ends a geometry edit, whether saved or cancelled: the form is cleared once, here.
  const endGeometryEdit = useCallback(() => {
    onEditingGeometryChange(null);
    onFormReset();
    onSelectedTabChange("routes");
  }, [onEditingGeometryChange, onFormReset, onSelectedTabChange]);

  const handleCancelGeometryEdit = useCallback(() => {
    endGeometryEdit();
    onRouteSelect?.(null);
  }, [endGeometryEdit, onRouteSelect]);

  return (
    <div
      style={sidebarWidth != null ? { width: sidebarWidth } : undefined}
      className="bg-surface border-r border-gray-200 flex flex-col flex-shrink-0"
    >
      {/* Tab Headers */}
      <div className="flex border-b border-gray-200">
        {/* Scenic only where the user map can show what is drawn there */}
        {TABS.filter(({ id }) => id !== "scenic" || region.hasScenicHighlight).map(
          ({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => switchTab(id)}
              className={tabBtn(activeTab === id)}
            >
              {label}
            </button>
          ),
        )}
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
            onRoutesChanged={onRoutesChanged}
            onEditGeometry={handleEditGeometry}
            onRouteFocus={onRouteFocus}
            availableTags={availableTags}
            onTagsChanged={loadTags}
          />
        )}

        {activeTab === "create" && (
          <AdminCreateRouteTab
            coordinates={createFormCoordinates}
            onCoordinatesChange={onCreateFormCoordinatesChange}
            previewRoute={previewRoute}
            onSaveRoute={onSaveRoute}
            editingGeometry={editingGeometry}
            onGeometryEditComplete={(saved) => {
              const trackId = editingGeometry?.track_id;
              endGeometryEdit();
              onRoutesChanged();
              // The new points go into the loaded detail at once: a second Edit
              // Geometry starts from them, and must not wait for (or, if it fails,
              // miss) the reload below.
              onSelectedRouteChange((prev) =>
                prev && prev.track_id === trackId
                  ? {
                      ...prev,
                      starting_coordinate: saved.startCoordinate,
                      ending_coordinate: saved.endCoordinate,
                    }
                  : prev,
              );
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
