"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditingGeometry } from "@/components/admin/AdminCreateRouteTab";
import type { EditingScenicLine } from "@/components/admin/AdminCreateScenicTab";
import type { AdminListKind } from "@/components/admin/AdminList";
import AdminSidebar, { type AdminTab } from "@/components/admin/AdminSidebar";
import MapLoading from "@/components/layout/MapLoading";
import Navbar from "@/components/layout/Navbar";
import SidebarResizer from "@/components/layout/SidebarResizer";
import { useAsyncLoad } from "@/hooks/useAsyncLoad";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useResizableSidebar } from "@/hooks/useResizableSidebar";
import { useSessionKeepAlive } from "@/hooks/useSessionKeepAlive";
import { actionErrorMessage, unwrap } from "@/lib/actionResult";
import {
  type AdminRouteDetail,
  getRailwayRoute,
  type SaveRouteData,
  saveRailwayRoute,
} from "@/lib/adminRouteActions";
import { logout, type User } from "@/lib/authActions";
import { type CreateFormCoordinates, useRoutePreview } from "@/lib/map/hooks/useRoutePreview";
import { RegionProvider, useRegion } from "@/lib/regionContext";
import type { RegionId } from "@/lib/shared/regions";
import type { RouteBounds } from "@/lib/shared/types";
import { useToast } from "@/lib/toast";
import { btn } from "@/lib/ui/buttonStyles";

// Dynamically import the map component to avoid SSR issues with MapLibre
const AdminMap = dynamic(() => import("@/components/admin/AdminMap"), {
  ssr: false,
  loading: MapLoading,
});

const NO_COORDINATES: CreateFormCoordinates = { startingCoordinate: null, endingCoordinate: null };

interface AdminPageClientProps {
  user: User;
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
  const { showError, showSuccess, showConfirm } = useToast();
  const router = useRouter();
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
  // A route picked from the list is flown to once its detail is in (one picked
  // on the map is already on screen). Held here, beside the load, rather than in
  // the list: the mobile drawer holding the list may close before the load ends.
  const focusOnLoadRef = useRef<number | null>(null);
  const [selectedTab, setSelectedTab] = useState<AdminTab>("routes");
  // Whether the admin is working on routes or scenic lines: what the Routes tab
  // lists, and so what the map is set up for there (see `scenicMode`). The New
  // Route / New Scenic tabs set it as they open.
  const [selectedListKind, setSelectedListKind] = useState<AdminListKind>("routes");
  // The create form's two picked points, held here and nowhere else: the map draws
  // them, the sidebar edits them, and the region switch below has to be able to
  // clear them. A second copy in the sidebar used to survive that clear and bring
  // the old region's preview straight back.
  const [createFormCoordinates, setCreateFormCoordinates] =
    useState<CreateFormCoordinates>(NO_COORDINATES);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  // Likewise the geometry edit in progress, which the map needs (it hides the
  // routes) as much as the sidebar does.
  const [editingGeometry, setEditingGeometry] = useState<EditingGeometry | null>(null);
  // A nonce, as for the note focus, so picking the same route again flies back to it
  const [focusBounds, setFocusBounds] = useState<{ bounds: RouteBounds; nonce: number } | null>(
    null,
  );
  const [focusCoordinate, setFocusCoordinate] = useState<{
    coordinate: [number, number];
    nonce: number;
  } | null>(null);
  const [notesRefreshTrigger, setNotesRefreshTrigger] = useState<number>(0);
  // The scenic lines' state, here rather than in the tabs for the same reasons as
  // the route's: the map reads it, and the mobile drawer unmounts the tabs.
  const [selectedScenicLineId, setSelectedScenicLineId] = useState<number | null>(null);
  const [editingScenicLine, setEditingScenicLine] = useState<EditingScenicLine | null>(null);
  const [scenicRefreshTrigger, setScenicRefreshTrigger] = useState(0);
  const region = useRegion();
  const regionId = region.id;
  // Scenic lines only in a region that shows them at all.
  const listKind: AdminListKind = region.hasScenicHighlight ? selectedListKind : "routes";
  // A geometry edit is only ever shown on its New tab.
  const activeTab: AdminTab = editingGeometry
    ? "newRoute"
    : editingScenicLine
      ? "newScenic"
      : selectedTab === "newScenic" && !region.hasScenicHighlight
        ? "routes"
        : selectedTab;
  // Scenic lines are being worked on: listed, or drawn. The map then hides the
  // routes so a click reaches the track under them, and selects scenic lines instead.
  const scenicMode = activeTab === "newScenic" || (activeTab === "routes" && listKind === "scenic");
  // The path found between the picked points: drawn by the map, saved by the form,
  // and gone as soon as either point is. Searched as a scenic line's save searches
  // it while scenic lines are worked on.
  const previewRoute = useRoutePreview(
    createFormCoordinates.startingCoordinate,
    createFormCoordinates.endingCoordinate,
    showError,
    { avoidBacktracking: scenicMode },
  );

  // Switching regions drops everything picked out of the old one: the selected
  // route, a half-finished coordinate pick and its preview all point at track
  // the map has just stopped showing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: regionId is the trigger; region follows it, and the setters are stable.
  useEffect(() => {
    setSelectedRouteId(null);
    setCreateFormCoordinates(NO_COORDINATES);
    setEditingGeometry(null);
    setFocusBounds(null);
    setSelectedScenicLineId(null);
    setEditingScenicLine(null);
    // Left on scenic lines the new region does not have, a map click would keep
    // picking for a form no longer on screen.
    if (!region.hasScenicHighlight) {
      setSelectedTab((tab) => (tab === "newScenic" ? "routes" : tab));
      setSelectedListKind("routes");
    }
  }, [regionId]);

  // A route selected (on the map, or by a duplicate) opens the routes list
  useEffect(() => {
    if (!selectedRouteId) return;
    setSelectedTab("routes");
    setSelectedListKind("routes");
  }, [selectedRouteId]);

  // Leaving scenic lines, however it happens (a tab or list switch, a route selected,
  // a route's geometry edit), drops their selection and any re-pick: the map would
  // otherwise keep highlighting a line no list shows. Coming to them drops the
  // route's selection likewise, the routes being hidden then.
  useEffect(() => {
    if (scenicMode) {
      setSelectedRouteId(null);
    } else {
      setSelectedScenicLineId(null);
      setEditingScenicLine(null);
    }
  }, [scenicMode]);

  const handleRouteFocus = useCallback((bounds: RouteBounds) => {
    setFocusBounds({ bounds, nonce: Date.now() });
  }, []);

  // However the selection moves on — a failed load, a region switch, a coordinate
  // click — a fly-to still waiting for the old route is dropped with it.
  useEffect(() => {
    if (focusOnLoadRef.current !== selectedRouteId) focusOnLoadRef.current = null;
  }, [selectedRouteId]);

  useEffect(() => {
    if (!selectedRouteDetail || focusOnLoadRef.current !== selectedRouteDetail.track_id) return;
    focusOnLoadRef.current = null;
    handleRouteFocus(selectedRouteDetail.bounds);
  }, [selectedRouteDetail, handleRouteFocus]);

  // A route whose detail cannot be loaded (deleted in another tab, session gone)
  // is not left selected: highlighted on the map with nothing to edit beside it.
  useEffect(() => {
    if (!selectedRoute.error) return;
    showError(`Failed to load route details: ${actionErrorMessage(selectedRoute.error)}`);
    setSelectedRouteId(null);
  }, [selectedRoute.error, showError]);

  // Shows a route as a write stored it, if it is still the selected one: the
  // selection may have moved on while the write was in flight.
  const applyStoredRoute = useCallback(
    (detail: AdminRouteDetail): boolean => {
      if (selectedRouteIdRef.current !== detail.track_id) return false;
      setSelectedRouteDetail(detail);
      return true;
    },
    [setSelectedRouteDetail],
  );

  // Resizable sidebar hook
  const { sidebarWidth, isResizing, handleMouseDown, sidebarOpen, toggleSidebar } =
    useResizableSidebar({ storageKey: "railway-admin-sidebar-width", isMobile });

  const handleRouteSelect = useCallback((routeId: number | null, { focus = false } = {}) => {
    // Any other selection drops a fly-to still waiting for its route
    focusOnLoadRef.current = focus ? routeId : null;
    // null unselects the route
    if (routeId === null) {
      setSelectedRouteId(null);
      return;
    }

    setSelectedRouteId((prevId) => {
      // A new route drops the picked points (and so the preview); clicking the
      // selected route again keeps them.
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
    // A click picks for whichever kind is being worked on: scenic lines, or else
    // routes (from the Notes tab too, whose map shows the routes).
    if (scenicMode) {
      setSelectedTab("newScenic");
    } else {
      setSelectedTab("newRoute");
      setSelectedListKind("routes");
    }
    // A new pick drops the selection; a geometry re-pick keeps its route or line
    // selected, for the reload after the save.
    if (!editingGeometry) setSelectedRouteId(null);
    if (!editingScenicLine) setSelectedScenicLineId(null);
  };

  // A scenic line selected, from its list or on the map, opens its list; one picked
  // on the map drops the points picked for a new line, as a route's selection does.
  const handleScenicLineSelect = useCallback((id: number | null) => {
    setSelectedScenicLineId(id);
    if (id === null) return;
    setSelectedTab("routes");
    setCreateFormCoordinates(NO_COORDINATES);
  }, []);

  // Throws on failure, which the form reports; it clears its fields only on success,
  // so a failed save leaves everything typed into it in place, to be retried.
  const handleSaveRoute = async (routeData: SaveRouteData) => {
    if (!previewRoute) throw new Error("No route preview to save");
    const { track_id: trackId } = unwrap(
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

    refreshRoutes();

    showSuccess(
      `Route "${routeData.name || `${routeData.from_station} ⟷ ${routeData.to_station}`}" saved successfully! Track ID: ${trackId}`,
    );
  };

  // Clears the picked points, and with them the preview drawn from them.
  const handleFormReset = useCallback(() => {
    setCreateFormCoordinates(NO_COORDINATES);
  }, []);

  const refreshRoutes = () => setRefreshTrigger((prev) => prev + 1);

  const handleEditingGeometryChange = useCallback((editing: EditingGeometry | null) => {
    setEditingGeometry(editing);
    // The fly-to effect re-runs when the edit ends, and would fly back to the route
    if (editing) setFocusBounds(null);
  }, []);

  const handleFocusNote = useCallback((coordinate: [number, number]) => {
    setFocusCoordinate({ coordinate, nonce: Date.now() });
  }, []);

  const handleNoteChanged = useCallback(() => {
    setNotesRefreshTrigger((prev) => prev + 1);
  }, []);

  async function handleLogout() {
    await logout();
  }

  // A session that ended under the page (see `useSessionKeepAlive`). The sign-in
  // form is on the main page; Not now leaves this one as it is, and its saves
  // then fail with "Admin access required".
  useSessionKeepAlive(user.id, () =>
    showConfirm({
      title: "Signed out",
      message: "Your session has ended. Sign in again on the map to keep editing.",
      confirmLabel: "Go to map",
      cancelLabel: "Not now",
      variant: "info",
      onConfirm: () => router.push("/"),
    }),
  );

  const sidebarContent = (
    <AdminSidebar
      selectedTab={activeTab}
      onSelectedTabChange={setSelectedTab}
      listKind={listKind}
      onListKindChange={setSelectedListKind}
      selectedRouteId={selectedRouteId}
      selectedRoute={selectedRouteDetail}
      selectedRouteLoading={selectedRouteLoading}
      onRouteStored={applyStoredRoute}
      onRouteSelect={handleRouteSelect}
      createFormCoordinates={createFormCoordinates}
      onCreateFormCoordinatesChange={setCreateFormCoordinates}
      editingGeometry={editingGeometry}
      onEditingGeometryChange={handleEditingGeometryChange}
      previewRoute={previewRoute}
      onSaveRoute={handleSaveRoute}
      onFormReset={handleFormReset}
      onRoutesChanged={refreshRoutes}
      onRouteFocus={handleRouteFocus}
      sidebarWidth={isMobile ? null : sidebarWidth}
      onFocusNote={handleFocusNote}
      onNoteChanged={handleNoteChanged}
      notesRefreshSignal={notesRefreshTrigger}
      editingScenicLine={editingScenicLine}
      onEditingScenicLineChange={setEditingScenicLine}
      selectedScenicLineId={selectedScenicLineId}
      onScenicLineSelect={handleScenicLineSelect}
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
            <SidebarResizer onMouseDown={handleMouseDown} isResizing={isResizing} />
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
            // While scenic lines are worked on, a click on one selects it, as a pick
            // from its list does. During a geometry re-pick the click picks a point.
            onScenicLineSelect={
              scenicMode && !editingScenicLine ? handleScenicLineSelect : undefined
            }
            onCoordinateClick={handleCoordinateClick}
            previewRoute={previewRoute}
            selectedCoordinates={createFormCoordinates}
            refreshTrigger={refreshTrigger}
            isEditingGeometry={!!editingGeometry}
            scenicMode={scenicMode}
            selectedScenicLineId={selectedScenicLineId}
            scenicRefreshTrigger={scenicRefreshTrigger}
            focusBounds={focusBounds}
            focusCoordinate={focusCoordinate}
            notesRefreshTrigger={notesRefreshTrigger}
            onNotesChanged={handleNoteChanged}
          />
        </div>
      </main>
    </div>
  );
}
