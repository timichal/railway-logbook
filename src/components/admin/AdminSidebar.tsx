"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminCreateRouteTab, {
  type CreateFormCoordinates,
  type EditingGeometry,
  type NewRouteData,
  type PathPreview,
} from "@/components/admin/AdminCreateRouteTab";
import AdminNotesTab from "@/components/admin/AdminNotesTab";
import AdminRoutesTab from "@/components/admin/AdminRoutesTab";
import { unwrap } from "@/lib/actionResult";
import { getFrequencyTags, getRailwayRoute } from "@/lib/adminRouteActions";
import { useToast } from "@/lib/toast";
import { tabBtn } from "@/lib/ui/buttonStyles";

interface AdminSidebarProps {
  selectedRouteId?: number | null;
  onRouteSelect?: (routeId: number | null) => void;
  /** Bumped per coordinate click on the map; switches to the create tab. */
  coordinateClickTrigger?: number;
  /** The create form's points. Owned by the page, which fills them from map clicks. */
  createFormCoordinates: CreateFormCoordinates;
  onCreateFormCoordinatesChange: React.Dispatch<React.SetStateAction<CreateFormCoordinates>>;
  /** The geometry edit in progress, also owned by the page (the map hides routes during it). */
  editingGeometry: EditingGeometry | null;
  onEditingGeometryChange: (editing: EditingGeometry | null) => void;
  previewRoute: PathPreview | null;
  onPreviewRoute?: (preview: PathPreview) => void;
  onCancelPreview?: () => void;
  onSaveRoute?: (routeData: NewRouteData) => Promise<boolean>;
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
}

export default function AdminSidebar({
  selectedRouteId,
  onRouteSelect,
  coordinateClickTrigger,
  createFormCoordinates,
  onCreateFormCoordinatesChange,
  editingGeometry,
  onEditingGeometryChange,
  previewRoute,
  onPreviewRoute,
  onCancelPreview,
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
}: AdminSidebarProps) {
  const { showError: showErrorToast } = useToast();
  const showError = showErrorProp || showErrorToast;
  const [selectedTab, setSelectedTab] = useState<"routes" | "create" | "notes">("routes");
  // A geometry edit is only ever shown on the create tab. Derived rather than set,
  // because the edit is the page's and this component's state is not: the mobile
  // drawer unmounts it, and a remount mid-edit opened on the routes tab with every
  // route still hidden on the map and no Cancel in sight.
  const activeTab = editingGeometry ? "create" : selectedTab;
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

  // Switch to create tab when a coordinate is clicked
  useEffect(() => {
    if (coordinateClickTrigger) {
      setSelectedTab("create");
    }
  }, [coordinateClickTrigger]);

  // Switch to routes tab when a route is selected
  useEffect(() => {
    if (selectedRouteId) {
      setSelectedTab("routes");
    }
  }, [selectedRouteId]);

  // Leaving the create tab abandons whatever was being picked there, a geometry
  // edit included — it would otherwise keep the routes hidden on the map behind a
  // tab that is no longer on screen.
  const leaveCreateTab = () => {
    onFormReset();
    if (editingGeometryRef.current) onEditingGeometryChange(null);
  };

  // Handle edit geometry button click
  const handleEditGeometry = useCallback(
    async (trackId: number) => {
      const request = ++editRequestRef.current;
      onEditingGeometryChange({ trackId, routeInfo: null });
      setSelectedTab("create");

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
        if (starting_coordinate && ending_coordinate) {
          onCreateFormCoordinatesChange((prev) =>
            prev.startingCoordinate || prev.endingCoordinate
              ? prev
              : { startingCoordinate: starting_coordinate, endingCoordinate: ending_coordinate },
          );
        } else {
          console.warn("Route does not have starting/ending coordinates stored");
        }
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
        showError(
          `Failed to load route details: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    },
    [onEditingGeometryChange, onCreateFormCoordinatesChange, showError],
  );

  // Ends a geometry edit, whether saved or cancelled: the form is cleared once, here.
  const endGeometryEdit = useCallback(() => {
    onEditingGeometryChange(null);
    onFormReset();
    setSelectedTab("routes");
  }, [onEditingGeometryChange, onFormReset]);

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
          onClick={() => {
            setSelectedTab("routes");
            leaveCreateTab();
          }}
          className={tabBtn(activeTab === "routes")}
        >
          Railway Routes
        </button>
        <button
          type="button"
          onClick={() => {
            setSelectedTab("create");
            // Unselect any selected route when switching to Create New
            if (onRouteSelect) {
              onRouteSelect(null);
            }
          }}
          className={tabBtn(activeTab === "create")}
        >
          Create New
        </button>
        <button
          type="button"
          onClick={() => {
            setSelectedTab("notes");
            if (onRouteSelect) onRouteSelect(null);
            leaveCreateTab();
          }}
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
            onPreviewRoute={onPreviewRoute}
            onCancelPreview={onCancelPreview}
            onSaveRoute={onSaveRoute}
            editingGeometryForTrackId={editingGeometry?.trackId ?? null}
            editingRouteInfo={editingGeometry?.routeInfo ?? null}
            onGeometryEditComplete={() => {
              endGeometryEdit();
              onRouteUpdated?.();
            }}
            onCancelGeometryEdit={handleCancelGeometryEdit}
            availableTags={availableTags}
            onTagsChanged={loadTags}
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
