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
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedCoordinate, setSelectedCoordinate] = useState<[number, number] | null>(null);
  const [coordinateClickTrigger, setCoordinateClickTrigger] = useState<number>(0); // Trigger to force effect to run
  const [previewRoute, setPreviewRoute] = useState<{
    partIds: string[],
    coordinates: [number, number][],
    railwayParts: RailwayPart[],
    startCoordinate: [number, number],
    endCoordinate: [number, number]
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
  const { sidebarWidth, isResizing, handleMouseDown } = useResizableSidebar();

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
    endCoordinate: [number, number]
  ) => {
    console.log('AdminPageClient: Preview route requested');
    console.log('Part IDs:', partIds);
    console.log('Coordinates count:', coordinates.length);
    console.log('Railway parts:', railwayParts.length);
    console.log('Start coordinate:', startCoordinate);
    console.log('End coordinate:', endCoordinate);

    setPreviewRoute({ partIds, coordinates, railwayParts, startCoordinate, endCoordinate });
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
        { partIds: previewRoute.partIds, coordinates: previewRoute.coordinates },
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

  return (
    <div className="h-screen flex flex-col bg-white">
      <Navbar
        user={user}
        onLogout={handleLogout}
        isAdminPage={true}
      />

      <main className="flex-1 overflow-hidden flex relative">
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
          sidebarWidth={sidebarWidth}
          showError={showError}
          showSuccess={showSuccess}
        />

        {/* Resizer */}
        <div
          onMouseDown={handleMouseDown}
          className={`w-1 bg-gray-200 hover:bg-blue-400 cursor-col-resize flex-shrink-0 ${isResizing ? 'bg-blue-400' : ''}`}
          style={{ userSelect: 'none' }}
        />

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
