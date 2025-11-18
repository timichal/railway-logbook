'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import VectorAdminMapWrapper from '@/components/VectorAdminMapWrapper';
import AdminSidebar from '@/components/AdminSidebar';
import { logout } from '@/lib/authActions';
import { saveRailwayRoute } from '@/lib/adminRouteActions';
import type { RailwayPart } from '@/lib/types';
import { useToast } from '@/lib/toast';

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
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [partClickTrigger, setPartClickTrigger] = useState<number>(0); // Trigger to force effect to run
  const [previewRoute, setPreviewRoute] = useState<{partIds: string[], coordinates: [number, number][], railwayParts: RailwayPart[]} | null>(null);
  const [createFormIds, setCreateFormIds] = useState<{startingId: string, endingId: string}>({startingId: '', endingId: ''});
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [editingGeometryForTrackId, setEditingGeometryForTrackId] = useState<string | null>(null);
  const [focusGeometry, setFocusGeometry] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(600); // Sidebar width in pixels
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [isSplittingMode, setIsSplittingMode] = useState<boolean>(false);
  const [splittingPartId, setSplittingPartId] = useState<string | null>(null);
  const [clearFieldForPartId, setClearFieldForPartId] = useState<string | null>(null);

  const handleRouteSelect = (routeId: string) => {
    // If empty string, unselect the route
    if (routeId === '') {
      setSelectedRouteId(null);
      return;
    }

    setSelectedRouteId(routeId);
    // Clear any selected parts when viewing a route
    setCreateFormIds({startingId: '', endingId: ''});
    // Clear preview mode
    setPreviewRoute(null);
    setIsPreviewMode(false);
  };

  const handlePartClick = (partId: string) => {
    setSelectedPartId(partId);
    setPartClickTrigger(prev => prev + 1); // Increment to force effect to run
    // Unselect any selected route when clicking a part
    setSelectedRouteId(null);
  };

  const handlePreviewRoute = (partIds: string[], coordinates: [number, number][], railwayParts: RailwayPart[]) => {
    console.log('AdminPageClient: Preview route requested');
    console.log('Part IDs:', partIds);
    console.log('Coordinates count:', coordinates.length);
    console.log('Railway parts:', railwayParts.length);
    setPreviewRoute({ partIds, coordinates, railwayParts });
    setIsPreviewMode(true);
  };

  const handleCancelPreview = () => {
    console.log('AdminPageClient: Preview cancelled');
    setPreviewRoute(null);
    setIsPreviewMode(false);
  };

  const handleSaveRoute = async (routeData: {from_station: string, to_station: string, track_number: string, description: string, usage_type: 0 | 1, frequency: string[], link: string}) => {
    console.log('AdminPageClient: Save route requested', routeData);

    if (!previewRoute) {
      console.error('AdminPageClient: No preview route to save');
      showError('Error: No route preview available to save');
      return;
    }

    try {
      const trackId = await saveRailwayRoute(routeData, previewRoute, previewRoute.railwayParts);
      console.log('AdminPageClient: Route saved successfully with auto-generated track_id:', trackId);

      // Clear preview mode
      setPreviewRoute(null);
      setIsPreviewMode(false);

      // Clear the form IDs (unselect start/end points)
      setCreateFormIds({startingId: '', endingId: ''});

      // Trigger routes layer refresh
      setRefreshTrigger(prev => prev + 1);

      showSuccess(`Route "${routeData.from_station} ⟷ ${routeData.to_station}" saved successfully! Track ID: ${trackId}`);

    } catch (error) {
      console.error('AdminPageClient: Error saving route:', error);
      showError(`Error saving route: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleFormReset = () => {
    // Clear the form IDs
    setCreateFormIds({startingId: '', endingId: ''});
  };

  const handleRouteDeleted = () => {
    // Trigger routes layer refresh after deletion
    setRefreshTrigger(prev => prev + 1);
  };

  const handleRouteUpdated = () => {
    // Trigger routes layer refresh after update
    setRefreshTrigger(prev => prev + 1);
  };

  const handleCreateFormIdsChange = (ids: {startingId: string, endingId: string}) => {
    setCreateFormIds(ids);
  };

  const handleEditingGeometryChange = (trackId: string | null) => {
    setEditingGeometryForTrackId(trackId);
  };

  const handleRouteFocus = (geometry: string) => {
    setFocusGeometry(geometry);
  };

  const handleEnterSplitMode = (partId: string) => {
    console.log('AdminPageClient: Entering split mode for part', partId);
    console.log('AdminPageClient: Current form IDs before split mode:', createFormIds);
    setIsSplittingMode(true);
    setSplittingPartId(partId);
  };

  const handleExitSplitMode = () => {
    console.log('AdminPageClient: Exiting split mode');
    setIsSplittingMode(false);
    setSplittingPartId(null);
  };

  const handleRefreshMap = () => {
    console.log('AdminPageClient: Refreshing map tiles');
    setRefreshTrigger(prev => prev + 1);
  };
  const handleSplitSuccess = (parentId: string) => {
    console.log('AdminPageClient: Split successful for part:', parentId);
    // Trigger field clearing in AdminSidebar by setting the clearFieldForPartId
    setClearFieldForPartId(parentId);
    // Reset it after a brief delay so it can be triggered again if needed
    setTimeout(() => setClearFieldForPartId(null), 100);
  };


  const handleMouseDown = () => {
    setIsResizing(true);
  };

  // Handle resize drag
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      // Constrain between 400px and 1200px
      if (newWidth >= 400 && newWidth <= 1200) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  async function handleLogout() {
    await logout();
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      <header className="bg-white border-b border-gray-200 p-4 flex-shrink-0">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Admin - Railway Management
            </h1>
            <p className="text-gray-600 mt-1">
              Welcome, {user.name || user.email} - Manage railway routes and view raw data
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 px-4 rounded-md text-sm"
            >
              Back to Main Map
            </Link>
            <form action={handleLogout}>
              <button
                type="submit"
                className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer"
              >
                Logout
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden flex relative">
        <AdminSidebar
          selectedRouteId={selectedRouteId}
          onRouteSelect={handleRouteSelect}
          selectedPartId={selectedPartId}
          partClickTrigger={partClickTrigger}
          onPreviewRoute={handlePreviewRoute}
          onCreateFormIdsChange={handleCreateFormIdsChange}
          isPreviewMode={isPreviewMode}
          onCancelPreview={handleCancelPreview}
          onSaveRoute={handleSaveRoute}
          onFormReset={handleFormReset}
          onRouteDeleted={handleRouteDeleted}
          onRouteUpdated={handleRouteUpdated}
          onEditingGeometryChange={handleEditingGeometryChange}
          onRouteFocus={handleRouteFocus}
          sidebarWidth={sidebarWidth}
          onEnterSplitMode={handleEnterSplitMode}
          onExitSplitMode={handleExitSplitMode}
          isSplittingMode={isSplittingMode}
          splittingPartId={splittingPartId}
          onRefreshMap={handleRefreshMap}
          splitRefreshTrigger={refreshTrigger}
          clearFieldForPartId={clearFieldForPartId}
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
          <VectorAdminMapWrapper
            className="w-full h-full"
            selectedRouteId={selectedRouteId}
            onRouteSelect={handleRouteSelect}
            onPartClick={handlePartClick}
            previewRoute={previewRoute}
            selectedParts={{startingId: createFormIds.startingId, endingId: createFormIds.endingId}}
            refreshTrigger={refreshTrigger}
            isEditingGeometry={!!editingGeometryForTrackId}
            focusGeometry={focusGeometry}
            isSplittingMode={isSplittingMode}
            splittingPartId={splittingPartId}
            onExitSplitMode={handleExitSplitMode}
            onRefreshMap={handleRefreshMap}
            showError={showError}
            onSplitSuccess={handleSplitSuccess}
            showSuccess={showSuccess}
          />
        </div>
      </main>
    </div>
  );
}
