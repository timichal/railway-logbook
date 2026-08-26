"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminSidebar from "@/components/admin/AdminSidebar";
import Navbar from "@/components/layout/Navbar";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useResizableSidebar } from "@/hooks/useResizableSidebar";
import { saveRailwayRoute } from "@/lib/adminRouteActions";
import { logout } from "@/lib/authActions";
import type { UsageType } from "@/lib/constants";
import { RegionProvider, useRegionId } from "@/lib/regionContext";
import type { RegionId } from "@/lib/regions";
import { useToast } from "@/lib/toast";
import type { RailwayPart } from "@/lib/types";
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
  const [selectedCoordinate, setSelectedCoordinate] = useState<[number, number] | null>(null);
  const [coordinateClickTrigger, setCoordinateClickTrigger] = useState<number>(0); // Trigger to force effect to run
  const [previewRoute, setPreviewRoute] = useState<{
    partIds: string[];
    coordinates: [number, number][];
    railwayParts: RailwayPart[];
    startCoordinate: [number, number];
    endCoordinate: [number, number];
    hasBacktracking?: boolean;
  } | null>(null);
  const [createFormCoordinates, setCreateFormCoordinates] = useState<{
    startingCoordinate: [number, number] | null;
    endingCoordinate: [number, number] | null;
  }>({ startingCoordinate: null, endingCoordinate: null });
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [editingGeometryForTrackId, setEditingGeometryForTrackId] = useState<number | null>(null);
  const [focusGeometry, setFocusGeometry] = useState<string | null>(null);
  const [focusCoordinate, setFocusCoordinate] = useState<{
    coordinate: [number, number];
    nonce: number;
  } | null>(null);
  const [notesRefreshTrigger, setNotesRefreshTrigger] = useState<number>(0);
  const regionId = useRegionId();

  // Switching regions drops everything picked out of the old one: the selected
  // route, a half-finished coordinate pick and its preview all point at track
  // the map has just stopped showing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: regionId is the trigger; the setters are stable and intentionally not read here.
  useEffect(() => {
    setSelectedRouteId(null);
    setPreviewRoute(null);
    setIsPreviewMode(false);
    setCreateFormCoordinates({ startingCoordinate: null, endingCoordinate: null });
    setEditingGeometryForTrackId(null);
    setFocusGeometry(null);
  }, [regionId]);

  // Resizable sidebar hook
  const { sidebarWidth, isResizing, handleMouseDown, sidebarOpen, toggleSidebar } =
    useResizableSidebar({ isMobile });

  const handleRouteSelect = useCallback((routeId: number | null) => {
    // null unselects the route
    if (routeId === null) {
      setSelectedRouteId(null);
      return;
    }

    setSelectedRouteId((prevId) => {
      // Only clear coordinates/preview if the route ID actually changed
      // This prevents clearing coordinates when re-selecting the same route
      // (which happens during "Edit Route Geometry")
      if (prevId !== routeId) {
        setCreateFormCoordinates({ startingCoordinate: null, endingCoordinate: null });
        setPreviewRoute(null);
        setIsPreviewMode(false);
      }
      return routeId;
    });
  }, []);

  const handleCoordinateClick = (coordinate: [number, number]) => {
    setSelectedCoordinate(coordinate);
    setCoordinateClickTrigger((prev) => prev + 1); // Increment to force effect to run
    // Unselect any selected route when clicking a coordinate
    setSelectedRouteId(null);
  };

  const handlePreviewRoute = (
    partIds: string[],
    coordinates: [number, number][],
    railwayParts: RailwayPart[],
    startCoordinate: [number, number],
    endCoordinate: [number, number],
    hasBacktracking?: boolean,
  ) => {
    console.log("AdminPageClient: Preview route requested");
    console.log("Part IDs:", partIds);
    console.log("Coordinates count:", coordinates.length);
    console.log("Railway parts:", railwayParts.length);
    console.log("Start coordinate:", startCoordinate);
    console.log("End coordinate:", endCoordinate);
    console.log("Has backtracking:", hasBacktracking);

    setPreviewRoute({
      partIds,
      coordinates,
      railwayParts,
      startCoordinate,
      endCoordinate,
      hasBacktracking,
    });
    setIsPreviewMode(true);
  };

  const handleCancelPreview = () => {
    console.log("AdminPageClient: Preview cancelled");
    setPreviewRoute(null);
    setIsPreviewMode(false);
  };

  const handleSaveRoute = async (routeData: {
    name: string;
    from_station: string;
    to_station: string;
    description: string;
    usage_type: UsageType;
    frequency: string[];
    link: string;
    scenic: boolean;
    intended_backtracking: boolean;
  }) => {
    console.log("AdminPageClient: Save route requested", routeData);

    if (!previewRoute) {
      console.error("AdminPageClient: No preview route to save");
      showError("Error: No route preview available to save");
      return;
    }

    try {
      const trackId = await saveRailwayRoute(
        routeData,
        {
          partIds: previewRoute.partIds,
          coordinates: previewRoute.coordinates,
          hasBacktracking: previewRoute.hasBacktracking,
        },
        previewRoute.startCoordinate,
        previewRoute.endCoordinate,
      );
      console.log(
        "AdminPageClient: Route saved successfully with auto-generated track_id:",
        trackId,
      );

      // Clear preview mode
      setPreviewRoute(null);
      setIsPreviewMode(false);

      // Clear the form coordinates (unselect start/end points)
      setCreateFormCoordinates({ startingCoordinate: null, endingCoordinate: null });

      // Trigger routes layer refresh
      setRefreshTrigger((prev) => prev + 1);

      showSuccess(
        `Route "${routeData.name || `${routeData.from_station} ⟷ ${routeData.to_station}`}" saved successfully! Track ID: ${trackId}`,
      );
    } catch (error) {
      console.error("AdminPageClient: Error saving route:", error);
      showError(`Error saving route: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleFormReset = () => {
    // Clear the form coordinates
    setCreateFormCoordinates({ startingCoordinate: null, endingCoordinate: null });
  };

  const handleRouteDeleted = () => {
    // Trigger routes layer refresh after deletion
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleRouteUpdated = () => {
    // Trigger routes layer refresh after update
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleCreateFormCoordinatesChange = (coordinates: {
    startingCoordinate: [number, number] | null;
    endingCoordinate: [number, number] | null;
  }) => {
    setCreateFormCoordinates(coordinates);
  };

  const handleEditingGeometryChange = (trackId: number | null) => {
    setEditingGeometryForTrackId(trackId);
    // Clear focus geometry when entering/exiting edit mode to prevent unwanted panning
    if (trackId) {
      setFocusGeometry(null);
    }
  };

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
      selectedRouteId={selectedRouteId}
      onRouteSelect={handleRouteSelect}
      selectedCoordinate={selectedCoordinate}
      coordinateClickTrigger={coordinateClickTrigger}
      onPreviewRoute={handlePreviewRoute}
      onCreateFormCoordinatesChange={handleCreateFormCoordinatesChange}
      isPreviewMode={isPreviewMode}
      onCancelPreview={handleCancelPreview}
      onSaveRoute={handleSaveRoute}
      onFormReset={handleFormReset}
      onRouteDeleted={handleRouteDeleted}
      onRouteUpdated={handleRouteUpdated}
      onEditingGeometryChange={handleEditingGeometryChange}
      onRouteFocus={handleRouteFocus}
      sidebarWidth={isMobile ? null : sidebarWidth}
      onFocusNote={handleFocusNote}
      onNoteChanged={handleNoteChanged}
      notesRefreshSignal={notesRefreshTrigger}
      showError={showError}
    />
  );

  return (
    <div className="h-dvh flex flex-col bg-white safe-area">
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
            <div className="fixed inset-y-0 left-0 z-40 w-full max-w-md bg-white flex flex-col sidebar-drawer-open safe-area">
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
            onRouteSelect={handleRouteSelect}
            onCoordinateClick={handleCoordinateClick}
            previewRoute={previewRoute}
            selectedCoordinates={{
              startingCoordinate: createFormCoordinates.startingCoordinate,
              endingCoordinate: createFormCoordinates.endingCoordinate,
            }}
            refreshTrigger={refreshTrigger}
            isEditingGeometry={!!editingGeometryForTrackId}
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
