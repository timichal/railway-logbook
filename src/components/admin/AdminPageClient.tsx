"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CreateFormCoordinates,
  EditingGeometry,
  NewRouteData,
  PathPreview,
} from "@/components/admin/AdminCreateRouteTab";
import AdminSidebar from "@/components/admin/AdminSidebar";
import Navbar from "@/components/layout/Navbar";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useResizableSidebar } from "@/hooks/useResizableSidebar";
import { unwrap } from "@/lib/actionResult";
import { saveRailwayRoute } from "@/lib/adminRouteActions";
import { logout } from "@/lib/authActions";
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
  // Bumped per coordinate click, so the sidebar can switch to its create tab.
  const [coordinateClickTrigger, setCoordinateClickTrigger] = useState<number>(0);
  // The path found between the picked points: drawn by the map, saved by the form.
  const [previewRoute, setPreviewRoute] = useState<PathPreview | null>(null);
  // The create form's two picked points, held here and nowhere else: the map draws
  // them, the sidebar edits them, and the region switch below has to be able to
  // clear them. A second copy in the sidebar used to survive that clear and bring
  // the old region's preview straight back.
  const [createFormCoordinates, setCreateFormCoordinates] =
    useState<CreateFormCoordinates>(NO_COORDINATES);
  // Read when a preview search returns, to tell whether its points are still picked.
  const createFormCoordinatesRef = useRef(createFormCoordinates);
  createFormCoordinatesRef.current = createFormCoordinates;
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
  const regionId = useRegionId();

  // Switching regions drops everything picked out of the old one: the selected
  // route, a half-finished coordinate pick and its preview all point at track
  // the map has just stopped showing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: regionId is the trigger; the setters are stable and intentionally not read here.
  useEffect(() => {
    setSelectedRouteId(null);
    setPreviewRoute(null);
    setCreateFormCoordinates(NO_COORDINATES);
    setEditingGeometry(null);
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
        setCreateFormCoordinates(NO_COORDINATES);
        setPreviewRoute(null);
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
    setCoordinateClickTrigger((prev) => prev + 1);
    // Unselect any selected route when clicking a coordinate
    setSelectedRouteId(null);
  };

  // A path search takes a round trip, and its points may be gone by the time it
  // returns — cleared by a region switch, by leaving the create tab, or replaced.
  // Taking the result anyway put the old points' path back on the map, saveable.
  const handlePreviewRoute = useCallback((preview: PathPreview) => {
    const current = createFormCoordinatesRef.current;
    if (
      current.startingCoordinate !== preview.startCoordinate ||
      current.endingCoordinate !== preview.endCoordinate
    ) {
      return;
    }
    setPreviewRoute(preview);
  }, []);

  const handleCancelPreview = () => {
    setPreviewRoute(null);
  };

  // Resolves whether the route was saved, so the form clears only then: a failed
  // save leaves everything typed into it in place, to be retried.
  const handleSaveRoute = async (routeData: NewRouteData): Promise<boolean> => {
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
      showError(`Error saving route: ${error instanceof Error ? error.message : "Unknown error"}`);
      return false;
    }
  };

  // Clears the picked points and the preview drawn from them: a preview whose
  // points are gone is one the form can no longer save or cancel.
  const handleFormReset = useCallback(() => {
    setCreateFormCoordinates(NO_COORDINATES);
    setPreviewRoute(null);
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
      selectedRouteId={selectedRouteId}
      onRouteSelect={handleRouteSelect}
      coordinateClickTrigger={coordinateClickTrigger}
      createFormCoordinates={createFormCoordinates}
      onCreateFormCoordinatesChange={setCreateFormCoordinates}
      editingGeometry={editingGeometry}
      onEditingGeometryChange={handleEditingGeometryChange}
      previewRoute={previewRoute}
      onPreviewRoute={handlePreviewRoute}
      onCancelPreview={handleCancelPreview}
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
            onRouteSelect={handleRouteSelect}
            onCoordinateClick={handleCoordinateClick}
            previewRoute={previewRoute}
            selectedCoordinates={createFormCoordinates}
            refreshTrigger={refreshTrigger}
            isEditingGeometry={!!editingGeometry}
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
