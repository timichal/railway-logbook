'use client';

import React, { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Navbar from '@/components/Navbar';
import AdminSidebar from '@/components/AdminSidebar';
import { logout } from '@/lib/authActions';
import { saveRailwayRoute } from '@/lib/adminRouteActions';
import type { RailwayPart } from '@/lib/types';
import { useToast } from '@/lib/toast';
import { useResizableSidebar } from '@/hooks/useResizableSidebar';
import { useIsMobile } from '@/hooks/useIsMobile';

// Dynamically import the map component to avoid SSR issues with MapLibre
const VectorAdminMap = dynamic(() => import('./VectorAdminMap'), {
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
}

export default function AdminPageClient({ user }: AdminPageClientProps) {
  const { showError, showSuccess } = useToast();
  const isMobile = useIsMobile();
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedCoordinate, setSelectedCoordinate] = useState<[number, number] | null>(null);
  const [coordinateClickTrigger, setCoordinateClickTrigger] = useState<number>(0); // Trigger to force effect to run
  const [previewRoute, setPreviewRoute] = useState<{
    partIds: string[],
    coordinates: [number, number][],
    railwayParts: RailwayPart[],
    startCoordinate: [number, number],
    endCoordinate: [number, number],
    hasBacktracking?: boolean
  } | null>(null);
  const [createFormCoordinates, setCreateFormCoordinates] = useState<{
    startingCoordinate: [number, number] | null,
    endingCoordinate: [number, number] | null
  }>({ startingCoordinate: null, endingCoordinate: null });
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [editingGeometryForTrackId, setEditingGeometryForTrackId] = useState<string | null>(null);
  const [focusGeometry, setFocusGeometry] = useState<string | null>(null);

  // Resizable sidebar hook
  const { sidebarWidth, isResizing, handleMouseDown, sidebarOpen, toggleSidebar } = useResizableSidebar({ isMobile });

  const handleRouteSelect = useCallback((routeId: string) => {
    // If empty string, unselect the route
    if (routeId === '') {
      setSelectedRouteId(null);
      return;
    }

    setSelectedRouteId(prevId => {
      // Only clear coordinates/preview if the route ID actually changed
      // This prevents clearing coordinates when re-selecting the same route
      // (which happens during "Edit Route Geometry")
      if (String(prevId) !== String(routeId)) {
        setCreateFormCoordinates({ startingCoordinate: null, endingCoordinate: null });
        setPreviewRoute(null);
        setIsPreviewMode(false);
      }
      return routeId;
    });
  }, []);

  const handleCoordinateClick = (coordinate: [number, number]) => {
    setSelectedCoordinate(coordinate);
    setCoordinateClickTrigger(prev => prev + 1); // Increment to force effect to run
    // Unselect any selected route when clicking a coordinate
    setSelectedRouteId(null);
  };

  const handlePreviewRoute = (
    partIds: string[],
    coordinates: [number, number][],
    railwayParts: RailwayPart[],
    startCoordinate: [number, number],
    endCoordinate: [number, number],
    hasBacktracking?: boolean
  ) => {
    console.log('AdminPageClient: Preview route requested');
    console.log('Part IDs:', partIds);
    console.log('Coordinates count:', coordinates.length);
    console.log('Railway parts:', railwayParts.length);
    console.log('Start coordinate:', startCoordinate);
    console.log('End coordinate:', endCoordinate);
    console.log('Has backtracking:', hasBacktracking);

    setPreviewRoute({ partIds, coordinates, railwayParts, startCoordinate, endCoordinate, hasBacktracking });
    setIsPreviewMode(true);
  };

  const handleCancelPreview = () => {
    console.log('AdminPageClient: Preview cancelled');
    setPreviewRoute(null);
    setIsPreviewMode(false);
  };

  const handleSaveRoute = async (routeData: {
    from_station: string,
    to_station: string,
    track_number: string,
    description: string,
    usage_type: 0 | 1,
    frequency: string[],
    link: string,
    scenic: boolean,
    hsl: boolean,
    intended_backtracking: boolean
  }) => {
    console.log('AdminPageClient: Save route requested', routeData);

    if (!previewRoute) {
      console.error('AdminPageClient: No preview route to save');
      showError('Error: No route preview available to save');
      return;
    }

    try {
      const trackId = await saveRailwayRoute(
        routeData,
        { partIds: previewRoute.partIds, coordinates: previewRoute.coordinates, hasBacktracking: previewRoute.hasBacktracking },
        previewRoute.startCoordinate,
        previewRoute.endCoordinate,
        previewRoute.railwayParts
      );
      console.log('AdminPageClient: Route saved successfully with auto-generated track_id:', trackId);

      // Clear preview mode
      setPreviewRoute(null);
      setIsPreviewMode(false);

      // Clear the form coordinates (unselect start/end points)
      setCreateFormCoordinates({ startingCoordinate: null, endingCoordinate: null });

      // Trigger routes layer refresh
      setRefreshTrigger(prev => prev + 1);

      showSuccess(`Route "${routeData.from_station} ⟷ ${routeData.to_station}" saved successfully! Track ID: ${trackId}`);

    } catch (error) {
      console.error('AdminPageClient: Error saving route:', error);
      showError(`Error saving route: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleFormReset = () => {
    // Clear the form coordinates
    setCreateFormCoordinates({ startingCoordinate: null, endingCoordinate: null });
  };

  const handleRouteDeleted = () => {
    // Trigger routes layer refresh after deletion
    setRefreshTrigger(prev => prev + 1);
  };

  const handleRouteUpdated = () => {
    // Trigger routes layer refresh after update
    setRefreshTrigger(prev => prev + 1);
  };

  const handleCreateFormCoordinatesChange = (coordinates: {
    startingCoordinate: [number, number] | null,
    endingCoordinate: [number, number] | null
  }) => {
    setCreateFormCoordinates(coordinates);
  };

  const handleEditingGeometryChange = (trackId: string | null) => {
    setEditingGeometryForTrackId(trackId);
    // Clear focus geometry when entering/exiting edit mode to prevent unwanted panning
    if (trackId) {
      setFocusGeometry(null);
    }
  };

  const handleRouteFocus = (geometry: string) => {
    setFocusGeometry(geometry);
  };

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
      showError={showError}
      showSuccess={showSuccess}
    />
  );

  return (
    <div className="h-dvh flex flex-col bg-white">
      <Navbar
        user={user}
        onLogout={handleLogout}
        isAdminPage={true}
        isMobile={isMobile}
        onToggleSidebar={toggleSidebar}
      />

      <main className="flex-1 overflow-hidden flex relative">
        {/* Desktop sidebar */}
        {!isMobile && (
          <>
            {sidebarContent}
            {/* Resizer */}
            <div
              onMouseDown={handleMouseDown}
              className={`w-1 bg-gray-200 hover:bg-blue-400 cursor-col-resize flex-shrink-0 ${isResizing ? 'bg-blue-400' : ''}`}
              style={{ userSelect: 'none' }}
            />
          </>
        )}

        {/* Mobile drawer overlay */}
        {isMobile && sidebarOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/40 z-30"
              onClick={toggleSidebar}
            />
            <div className="fixed inset-y-0 left-0 z-40 w-full max-w-md bg-white flex flex-col sidebar-drawer-open">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 flex-shrink-0">
                <span className="text-sm font-medium text-gray-700">Admin Sidebar</span>
                <button
                  onClick={toggleSidebar}
                  className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded cursor-pointer"
                  aria-label="Close sidebar"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-hidden flex flex-col">
                {sidebarContent}
              </div>
            </div>
          </>
        )}

        <div className="flex-1 overflow-hidden">
          <VectorAdminMap
            className="w-full h-full"
            selectedRouteId={selectedRouteId}
            onRouteSelect={handleRouteSelect}
            onCoordinateClick={handleCoordinateClick}
            previewRoute={previewRoute}
            selectedCoordinates={{
              startingCoordinate: createFormCoordinates.startingCoordinate,
              endingCoordinate: createFormCoordinates.endingCoordinate
            }}
            refreshTrigger={refreshTrigger}
            isEditingGeometry={!!editingGeometryForTrackId}
            focusGeometry={focusGeometry}
            showSuccess={showSuccess}
            showError={showError}
          />
        </div>
      </main>
    </div>
  );
}
