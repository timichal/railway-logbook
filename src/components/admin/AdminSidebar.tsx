"use client";

import { useCallback, useEffect, useState } from "react";
import AdminCreateRouteTab, { type EditingGeometry } from "@/components/admin/AdminCreateRouteTab";
import AdminCreateScenicTab, {
  type EditingScenicLine,
} from "@/components/admin/AdminCreateScenicTab";
import { type AdminListKind, AdminListKindSwitch } from "@/components/admin/AdminList";
import AdminNotesTab from "@/components/admin/AdminNotesTab";
import AdminRoutesTab from "@/components/admin/AdminRoutesTab";
import AdminScenicLinesTab from "@/components/admin/AdminScenicLinesTab";
import { NO_ROUTE_SUGGESTIONS } from "@/components/admin/RouteMetadataFields";
import { unwrap } from "@/lib/actionResult";
import {
  type AdminRouteDetail,
  getRouteSuggestions,
  type SaveRouteData,
} from "@/lib/adminRouteActions";
import type { CreateFormCoordinates, PathPreview } from "@/lib/map/hooks/useRoutePreview";
import { useRegion } from "@/lib/regionContext";
import type { RouteBounds } from "@/lib/shared/types";
import { tabBtn } from "@/lib/ui/buttonStyles";

export type AdminTab = "routes" | "newRoute" | "newScenic" | "notes";

const TABS: { id: AdminTab; label: string }[] = [
  { id: "routes", label: "Routes" },
  { id: "newRoute", label: "New Route" },
  { id: "newScenic", label: "New Scenic" },
  { id: "notes", label: "Notes" },
];

interface AdminSidebarProps {
  /**
   * The open tab, held by the page: the map behaves differently while scenic lines
   * are worked on (routes hidden), and the mobile drawer unmounts this component,
   * which would otherwise reopen on the routes tab mid-pick.
   */
  selectedTab: AdminTab;
  onSelectedTabChange: (tab: AdminTab) => void;
  /**
   * What the Routes tab lists, held by the page for the same reasons. Always
   * "routes" in a region without scenic lines.
   */
  listKind: AdminListKind;
  onListKindChange: (kind: AdminListKind) => void;
  selectedRouteId?: number | null;
  /** The selected route's detail, loaded by the page (the map reads it too). */
  selectedRoute: AdminRouteDetail | null;
  selectedRouteLoading: boolean;
  /**
   * A write returned the route as stored: it replaces the selected route's detail
   * if that is still this route. Returns whether it did.
   */
  onRouteStored: (route: AdminRouteDetail) => boolean;
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
  onRouteFocus: (bounds: RouteBounds) => void;
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
  // Already resolved by the page: a geometry edit is always on its New tab
  selectedTab: activeTab,
  onSelectedTabChange,
  listKind,
  onListKindChange,
  selectedRouteId,
  selectedRoute,
  selectedRouteLoading,
  onRouteStored,
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
  const region = useRegion();
  const [suggestions, setSuggestions] = useState(NO_ROUTE_SUGGESTIONS);

  // Load the in-use usage tags and line names for autocomplete, and keep them
  // fresh after edits.
  const loadSuggestions = useCallback(async () => {
    try {
      setSuggestions(unwrap(await getRouteSuggestions()));
    } catch (error) {
      console.error("Error loading route suggestions:", error);
    }
  }, []);

  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  // Drops whatever was being picked: the points, and a geometry re-pick (a route's
  // would otherwise keep the routes hidden behind a tab no longer on screen).
  const abandonPick = () => {
    onFormReset();
    if (editingGeometry) onEditingGeometryChange(null);
    if (editingScenicLine) onEditingScenicLineChange(null);
  };

  const unselectAll = () => {
    onRouteSelect?.(null);
    onScenicLineSelect(null);
  };

  // Switching tabs abandons the pick on the one left behind. A New tab drops the
  // selection, as a pick on the map does, and sets which kind the map is set up for.
  const switchTab = (tab: AdminTab) => {
    if (tab === activeTab) return;
    abandonPick();
    if (tab !== "routes") unselectAll();
    if (tab === "newRoute") onListKindChange("routes");
    if (tab === "newScenic") onListKindChange("scenic");
    onSelectedTabChange(tab);
  };

  const switchListKind = (kind: AdminListKind) => {
    if (kind === listKind) return;
    abandonPick();
    unselectAll();
    onListKindChange(kind);
  };

  // Only the selected route offers Edit Geometry, so its loaded detail has the
  // stored points to start the re-pick from.
  const handleEditGeometry = (route: AdminRouteDetail) => {
    onEditingGeometryChange(route);
    onCreateFormCoordinatesChange({
      startingCoordinate: route.starting_coordinate,
      endingCoordinate: route.ending_coordinate,
    });
    onSelectedTabChange("newRoute");
  };

  // The scenic re-pick happens on the New Scenic tab, as a route's on New Route.
  const handleEditScenicGeometry = (
    line: EditingScenicLine,
    points: { starting_coordinate: [number, number]; ending_coordinate: [number, number] },
  ) => {
    onEditingScenicLineChange(line);
    // The stored points, so the current path shows until one of them is re-picked
    onCreateFormCoordinatesChange({
      startingCoordinate: points.starting_coordinate,
      endingCoordinate: points.ending_coordinate,
    });
    onSelectedTabChange("newScenic");
  };

  // Ends a scenic re-pick, saved or cancelled, back on its list; cancelled, it
  // unselects the line, as a route's cancel does.
  const endScenicGeometryEdit = (cancelled: boolean) => {
    onEditingScenicLineChange(null);
    onFormReset();
    if (cancelled) onScenicLineSelect(null);
    onSelectedTabChange("routes");
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

  // The lists shown since the Routes tab opened. A list mounts (and loads) only once
  // it is shown, then stays mounted until the tab closes: the routes list is the
  // region's every route, not worth fetching for an admin on the scenic lines.
  const shownKind = activeTab === "routes" ? listKind : null;
  const [mountedKinds, setMountedKinds] = useState<ReadonlySet<AdminListKind>>(new Set());
  if (shownKind === null ? mountedKinds.size > 0 : !mountedKinds.has(shownKind)) {
    setMountedKinds(shownKind === null ? new Set() : new Set([...mountedKinds, shownKind]));
  }
  const listMounted = (kind: AdminListKind) => kind === shownKind || mountedKinds.has(kind);

  const kindSwitch = region.hasScenicHighlight ? (
    <AdminListKindSwitch kind={listKind} onChange={switchListKind} />
  ) : undefined;

  return (
    <div
      style={sidebarWidth != null ? { width: sidebarWidth } : undefined}
      className="bg-surface border-r border-gray-200 flex flex-col flex-shrink-0"
    >
      {/* Tab Headers */}
      <div className="flex border-b border-gray-200">
        {/* New Scenic only where the user map can show what is drawn there */}
        {TABS.filter(({ id }) => id !== "newScenic" || region.hasScenicHighlight).map(
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
        {/* A list once shown stays mounted while the tab is open, the hidden one
            keeping its search, filters and page for the switch back. */}
        {activeTab === "routes" && (
          <>
            {listMounted("routes") && (
              <div className={listKind === "routes" ? "h-full" : "hidden"}>
                <AdminRoutesTab
                  toolbar={kindSwitch}
                  selectedRouteId={selectedRouteId}
                  selectedRoute={selectedRoute}
                  selectedRouteLoading={selectedRouteLoading}
                  onRouteStored={onRouteStored}
                  onRouteSelect={onRouteSelect}
                  onRoutesChanged={onRoutesChanged}
                  onEditGeometry={handleEditGeometry}
                  onRouteFocus={onRouteFocus}
                  suggestions={suggestions}
                  onSuggestionsChanged={loadSuggestions}
                />
              </div>
            )}
            {region.hasScenicHighlight && listMounted("scenic") && (
              <div className={listKind === "scenic" ? "h-full" : "hidden"}>
                <AdminScenicLinesTab
                  toolbar={kindSwitch}
                  selectedId={selectedScenicLineId}
                  onSelect={onScenicLineSelect}
                  onFocusBounds={onRouteFocus}
                  onEditGeometry={handleEditScenicGeometry}
                  onChanged={onScenicLinesChanged}
                />
              </div>
            )}
          </>
        )}

        {activeTab === "newRoute" && (
          <AdminCreateRouteTab
            coordinates={createFormCoordinates}
            onCoordinatesChange={onCreateFormCoordinatesChange}
            previewRoute={previewRoute}
            onSaveRoute={onSaveRoute}
            editingGeometry={editingGeometry}
            onGeometryEditComplete={(route) => {
              endGeometryEdit();
              onRoutesChanged();
              // The route stays selected, and the re-pick changed its points,
              // length and validity: the banner, the map's length box and a
              // second Edit Geometry all follow the route as stored.
              onRouteStored(route);
            }}
            onCancelGeometryEdit={handleCancelGeometryEdit}
            suggestions={suggestions}
            onSuggestionsChanged={loadSuggestions}
          />
        )}

        {activeTab === "newScenic" && (
          <AdminCreateScenicTab
            coordinates={createFormCoordinates}
            onCoordinatesChange={onCreateFormCoordinatesChange}
            previewRoute={previewRoute}
            onFormReset={onFormReset}
            editing={editingScenicLine}
            onGeometryEditComplete={() => endScenicGeometryEdit(false)}
            onCancelGeometryEdit={() => endScenicGeometryEdit(true)}
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
