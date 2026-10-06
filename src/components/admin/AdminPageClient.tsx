"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CreateFormCoordinates,
  EditingGeometry,
} from "@/components/admin/AdminCreateRouteTab";
import type { EditingScenicLine } from "@/components/admin/AdminScenicTab";
import AdminSidebar, { type AdminTab } from "@/components/admin/AdminSidebar";
import Navbar from "@/components/layout/Navbar";
import { useAsyncLoad } from "@/hooks/useAsyncLoad";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useResizableSidebar } from "@/hooks/useResizableSidebar";
import { actionErrorMessage, unwrap } from "@/lib/actionResult";
import {
  type AdminRouteDetail,
  getRailwayRoute,
  type SaveRouteData,
  saveRailwayRoute,
} from "@/lib/adminRouteActions";
import { logout } from "@/lib/authActions";
import { useRoutePreview } from "@/lib/map/hooks/useRoutePreview";
import { RegionProvider, useRegionId } from "@/lib/regionContext";
import type { RegionId } from "@/lib/shared/regions";
import { useToast } from "@/lib/toast";
import { btn } from "@/lib/ui/buttonStyles";

// Dynamically import the map component to avoid SSR issues with MapLibre
const AdminMap = dynamic(() => import("@/components/admin/AdminMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="text-gray-600">Loading map...</div>
    </div>
  ),
});

const NO_COORDINATES: CreateFormCoordinates = { startingCoordinate: null, endingCoordinate: null };

interface AdminPageClientProps {
  user: {
    id: number;
    name?: string;
    email: string;
  };
  initialRegion: RegionId;
}

export default function AdminPageClient({ user, initialRegion }: AdminPageClientProps) {
  return (
    <RegionProvider initialRegion={initialRegion}>
      <AdminPage user={user} />
    </RegionProvider>
  );
}

function AdminPage({ user }: { user: AdminPageClientProps["user"] }) {
  const { showError, showSuccess } = useToast();
  const isMobile = useIsMobile();
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  // The selected route's detail, loaded here once for both of its readers: the
  // sidebar's edit form and the map's length box. The map used to fetch it again
  // for the length alone, with nothing to stop an earlier selection's reply
  // landing last. Here rather than in the sidebar because the mobile drawer
  // unmounts the sidebar, and the map still wants the length.
  const selectedRoute = useAsyncLoad(
    () =>
      selectedRouteId === null
        ? Promise.resolve(null)
        : getRailwayRoute(selectedRouteId).then(unwrap),
    [selectedRouteId],
    "route details",
  );
  const selectedRouteLoading = selectedRouteId !== null && selectedRoute.loading;
  const { data: selectedRouteDetail, setData: setSelectedRouteDetail } = selectedRoute;
  // Read after an await, to tell whether the selection has moved on meanwhile.
  const selectedRouteIdRef = useRef(selectedRouteId);
  selectedRouteIdRef.current = selectedRouteId;
  // A route picked from the list is flown to once its geometry is in (one picked
  // on the map is already on screen). Held here, beside the load, rather than in
  // the list: the mobile drawer holding the list may close before the load ends.
  const focusOnLoadRef = useRef<number | null>(null);
  const [selectedTab, setSelectedTab] = useState<AdminTab>("routes");
  // The create form's two picked points, held here and nowhere else: the map draws
  // them, the sidebar edits them, and the region switch below has to be able to
  // clear them. A second copy in the sidebar used to survive that clear and bring
  // the old region's preview straight back.
  const [createFormCoordinates, setCreateFormCoordinates] =
    useState<CreateFormCoordinates>(NO_COORDINATES);
  // The path found between the picked points: drawn by the map, saved by the form,
  // and gone as soon as either point is.
  const previewRoute = useRoutePreview(
    createFormCoordinates.startingCoordinate,
    createFormCoordinates.endingCoordinate,
    showError,
  );
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  // Likewise the geometry edit in progress, which the map needs (it hides the
  // routes) as much as the sidebar does.
  const [editingGeometry, setEditingGeometry] = useState<EditingGeometry | null>(null);
  const [focusGeometry, setFocusGeometry] = useState<string | null>(null);
  const [focusCoordinate, setFocusCoordinate] = useState<{
    coordinate: [number, number];
    nonce: number;
  } | null>(null);
  const [notesRefreshTrigger, setNotesRefreshTrigger] = useState<number>(0);
  // The Scenic tab's state, here rather than in the tab for the same reasons as the
  // route's: the map reads it, and the mobile drawer unmounts the tab.
  const [selectedScenicLineId, setSelectedScenicLineId] = useState<number | null>(null);
  const [editingScenicLine, setEditingScenicLine] = useState<EditingScenicLine | null>(null);
  const [scenicRefreshTrigger, setScenicRefreshTrigger] = useState(0);
  const regionId = useRegionId();
  // A route's geometry edit is only ever shown on the create tab
  const activeTab: AdminTab = editingGeometry ? "create" : selectedTab;

  // Switching regions drops everything picked out of the old one: the selected
  // route, a half-finished coordinate pick and its preview all point at track
  // the map has just stopped showing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: regionId is the trigger; the setters are stable and intentionally not read here.
  useEffect(() => {
    setSelectedRouteId(null);
    setCreateFormCoordinates(NO_COORDINATES);
    setEditingGeometry(null);
    setFocusGeometry(null);
    setSelectedScenicLineId(null);
    setEditingScenicLine(null);
  }, [regionId]);

  // A route selected (on the map, or by a duplicate) opens the routes tab
  useEffect(() => {
    if (selectedRouteId) setSelectedTab("routes");
  }, [selectedRouteId]);

  // Leaving the Scenic tab, however it happens (a tab click, a route selected, a
  // route's geometry edit), drops its selection and any geometry re-pick: the map
  // would otherwise keep highlighting a line no list shows.
  useEffect(() => {
    if (activeTab === "scenic") return;
    setSelectedScenicLineId(null);
    setEditingScenicLine(null);
  }, [activeTab]);

  // However the selection moves on — a failed load, a region switch, a coordinate
  // click — a fly-to still waiting for the old route is dropped with it.
  useEffect(() => {
    if (focusOnLoadRef.current !== selectedRouteId) focusOnLoadRef.current = null;
  }, [selectedRouteId]);

  useEffect(() => {
    if (!selectedRouteDetail || focusOnLoadRef.current !== selectedRouteDetail.track_id) return;
    focusOnLoadRef.current = null;
    if (selectedRouteDetail.geometry) setFocusGeometry(selectedRouteDetail.geometry);
  }, [selectedRouteDetail]);

  // A route whose detail cannot be loaded (deleted in another tab, session gone)
  // is not left selected: highlighted on the map with nothing to edit beside it.
  useEffect(() => {
    if (!selectedRoute.error) return;
    showError(`Failed to load route details: ${actionErrorMessage(selectedRoute.error)}`);
    setSelectedRouteId(null);
  }, [selectedRoute.error, showError]);

  // Re-reads the selected route after a save changed it on the server (validity,
  // length, the under-repair flag), keeping the loaded detail on screen meanwhile.
  // Resolves the detail it applied, or null if the selection moved on first.
  const reloadSelectedRoute = useCallback(async (): Promise<AdminRouteDetail | null> => {
    const trackId = selectedRouteIdRef.current;
    if (trackId === null) return null;
    const detail = unwrap(await getRailwayRoute(trackId));
    if (selectedRouteIdRef.current !== trackId) return null;
    setSelectedRouteDetail(detail);
    return detail;
  }, [setSelectedRouteDetail]);

  // Resizable sidebar hook
  const { sidebarWidth, isResizing, handleMouseDown, sidebarOpen, toggleSidebar } =
    useResizableSidebar({ isMobile });

  const handleRouteSelect = useCallback((routeId: number | null, { focus = false } = {}) => {
    // Any other selection drops a fly-to still waiting for its route
    focusOnLoadRef.current = focus ? routeId : null;
    // null unselects the route
    if (routeId === null) {
      setSelectedRouteId(null);
      return;
    }

    setSelectedRouteId((prevId) => {
      // Only clear the points (and so the preview) if the route ID actually changed
      // This prevents clearing coordinates when re-selecting the same route
      // (which happens during "Edit Route Geometry")
      if (prevId !== routeId) {
        setCreateFormCoordinates(NO_COORDINATES);
      }
      return routeId;
    });
  }, []);

  const handleCoordinateClick = (coordinate: [number, number]) => {
    // Fill the first empty point; with both picked, a click changes nothing until
    // one of them is cleared.
    setCreateFormCoordinates((prev) => {
      if (!prev.startingCoordinate) return { ...prev, startingCoordinate: coordinate };
      if (!prev.endingCoordinate) return { ...prev, endingCoordinate: coordinate };
      return prev;
    });
    // A click picks for whichever form is open: the scenic one, or else the route one
    setSelectedTab((tab) => (tab === "scenic" ? tab : "create"));
    // Unselect any selected route when clicking a coordinate
    setSelectedRouteId(null);
  };

  // Resolves whether the route was saved, so the form clears only then: a failed
  // save leaves everything typed into it in place, to be retried.
  const handleSaveRoute = async (routeData: SaveRouteData): Promise<boolean> => {
    if (!previewRoute) {
      console.error("AdminPageClient: No preview route to save");
      showError("Error: No route preview available to save");
      return false;
    }

    try {
      const trackId = unwrap(
        await saveRailwayRoute(
          routeData,
          {
            partIds: previewRoute.partIds,
            coordinates: previewRoute.coordinates,
            hasBacktracking: previewRoute.hasBacktracking,
          },
          previewRoute.startCoordinate,
          previewRoute.endCoordinate,
        ),
      );

      // Clear the picked points and the preview; the form clears its own fields
      handleFormReset();

      // Trigger routes layer refresh
      setRefreshTrigger((prev) => prev + 1);

      showSuccess(
        `Route "${routeData.name || `${routeData.from_station} ⟷ ${routeData.to_station}`}" saved successfully! Track ID: ${trackId}`,
      );
      return true;
    } catch (error) {
      console.error("AdminPageClient: Error saving route:", error);
      showError(`Error saving route: ${actionErrorMessage(error)}`);
      return false;
    }
  };

  // Clears the picked points, and with them the preview drawn from them.
  const handleFormReset = useCallback(() => {
    setCreateFormCoordinates(NO_COORDINATES);
  }, []);

  const handleRouteDeleted = () => {
    // Trigger routes layer refresh after deletion
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleRouteUpdated = () => {
    // Trigger routes layer refresh after update
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleEditingGeometryChange = useCallback((editing: EditingGeometry | null) => {
    setEditingGeometry(editing);
    // Clear focus geometry when entering/exiting edit mode to prevent unwanted panning
    if (editing) {
      setFocusGeometry(null);
    }
  }, []);

  const handleRouteFocus = (geometry: string) => {
    setFocusGeometry(geometry);
  };

  const handleFocusNote = useCallback((coordinate: [number, number]) => {
    setFocusCoordinate({ coordinate, nonce: Date.now() });
  }, []);

  const handleNoteChanged = useCallback(() => {
    setNotesRefreshTrigger((prev) => prev + 1);
  }, []);

  async function handleLogout() {
    await logout();
  }

  const sidebarContent = (
    <AdminSidebar
      selectedTab={activeTab}
      onSelectedTabChange={setSelectedTab}
      selectedRouteId={selectedRouteId}
      selectedRoute={selectedRouteDetail}
      selectedRouteLoading={selectedRouteLoading}
      onSelectedRouteChange={setSelectedRouteDetail}
      onReloadSelectedRoute={reloadSelectedRoute}
      onRouteSelect={handleRouteSelect}
      createFormCoordinates={createFormCoordinates}
      onCreateFormCoordinatesChange={setCreateFormCoordinates}
      editingGeometry={editingGeometry}
      onEditingGeometryChange={handleEditingGeometryChange}
      previewRoute={previewRoute}
      onSaveRoute={handleSaveRoute}
      onFormReset={handleFormReset}
      onRouteDeleted={handleRouteDeleted}
      onRouteUpdated={handleRouteUpdated}
      onRouteFocus={handleRouteFocus}
      sidebarWidth={isMobile ? null : sidebarWidth}
      onFocusNote={handleFocusNote}
      onNoteChanged={handleNoteChanged}
      notesRefreshSignal={notesRefreshTrigger}
      showError={showError}
      editingScenicLine={editingScenicLine}
      onEditingScenicLineChange={setEditingScenicLine}
      selectedScenicLineId={selectedScenicLineId}
      onScenicLineSelect={setSelectedScenicLineId}
      onScenicLinesChanged={() => setScenicRefreshTrigger((prev) => prev + 1)}
    />
  );

  return (
    <div className="h-dvh flex flex-col bg-surface safe-area">
      <Navbar user={user} onLogout={handleLogout} isAdminPage={true} onOpenMenu={toggleSidebar} />

      <main className="flex-1 overflow-hidden flex relative">
        {/* Desktop sidebar */}
        {!isMobile && (
          <>
            {sidebarContent}
            {/* Resizer: mouse-only drag handle (keyboard resize intentionally unsupported) */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: mouse-only resize affordance with no keyboard equivalent; the sidebar remains fully usable without resizing. */}
            <div
              onMouseDown={handleMouseDown}
              className={`w-1 bg-gray-200 hover:bg-blue-400 cursor-col-resize flex-shrink-0 ${isResizing ? "bg-blue-400" : ""}`}
              style={{ userSelect: "none" }}
            />
          </>
        )}

        {/* Mobile drawer overlay */}
        {isMobile && sidebarOpen && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 bg-black/40 z-30"
              onClick={toggleSidebar}
            />
            <div className="fixed inset-y-0 left-0 z-40 w-full max-w-md bg-surface flex flex-col sidebar-drawer-open safe-area">
              <div className="border-b border-gray-200 px-3 py-2 flex flex-wrap gap-2 flex-shrink-0">
                <Link href="/" className={btn("neutral", "xs")}>
                  Back to Map
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className={`${btn("danger", "xs")} ml-auto`}
                >
                  Log out
                </button>
              </div>
              <div className="flex-1 overflow-hidden flex flex-col">{sidebarContent}</div>
            </div>
          </>
        )}

        <div className="flex-1 overflow-hidden">
          <AdminMap
            className="w-full h-full"
            selectedRouteId={selectedRouteId}
            selectedRouteLength={selectedRouteDetail?.length_km ?? null}
            onRouteSelect={handleRouteSelect}
            onCoordinateClick={handleCoordinateClick}
            previewRoute={previewRoute}
            selectedCoordinates={createFormCoordinates}
            refreshTrigger={refreshTrigger}
            isEditingGeometry={!!editingGeometry}
            scenicMode={activeTab === "scenic"}
            selectedScenicLineId={selectedScenicLineId}
            scenicRefreshTrigger={scenicRefreshTrigger}
            focusGeometry={focusGeometry}
            focusCoordinate={focusCoordinate}
            notesRefreshTrigger={notesRefreshTrigger}
            onNotesChanged={handleNoteChanged}
            showSuccess={showSuccess}
            showError={showError}
          />
        </div>
      </main>
    </div>
  );
}
