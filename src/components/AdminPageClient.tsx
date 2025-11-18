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
  const [viewingSegmentsForPart, setViewingSegmentsForPart] = useState<string | null>(null); // Part whose segments are being viewed (not selected)
  const [previewRoute, setPreviewRoute] = useState<{partIds: string[], coordinates: [number, number][], railwayParts: RailwayPart[]} | null>(null);
  const [createFormIds, setCreateFormIds] = useState<{startingId: string, endingId: string}>({startingId: '', endingId: ''});
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [editingGeometryForTrackId, setEditingGeometryForTrackId] = useState<string | null>(null);
  const [focusGeometry, setFocusGeometry] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(600); // Sidebar width in pixels
  const [isResizing, setIsResizing] = useState<boolean>(false);

  // Split mode state
  const [isSplitMode, setIsSplitMode] = useState<boolean>(false);
  const [splittingPartId, setSplittingPartId] = useState<string | null>(null);
  const [splittingFieldTarget, setSplittingFieldTarget] = useState<'starting' | 'ending' | null>(null); // Track which field initiated split
  const [splitCompletedTrigger, setSplitCompletedTrigger] = useState<number>(0);

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

  const handlePartClick = async (partId: string) => {
    console.log('AdminPageClient: Part clicked:', partId, 'Split mode:', isSplitMode, 'Target:', splittingFieldTarget);

    // If we're in split mode and a segment was clicked, fill the target field
    if (isSplitMode && splittingFieldTarget && partId.includes('_seg')) {
      console.log(`AdminPageClient: Filling ${splittingFieldTarget} field with segment:`, partId);

      if (splittingFieldTarget === 'starting') {
        // Update starting ID via the form IDs
        setCreateFormIds(prev => ({ ...prev, startingId: partId }));
      } else {
        // Update ending ID via the form IDs
        setCreateFormIds(prev => ({ ...prev, endingId: partId }));
      }

      // Deactivate split mode after selecting segment
      handleSplitModeDeactivate();

      // Don't run the normal auto-fill logic
      return;
    }

    // Check if this is a split part (not a segment, not in split mode)
    if (!isSplitMode && !partId.includes('_seg')) {
      const { getSplitForPart } = await import('@/lib/railwayPartSplitsActions');
      const split = await getSplitForPart(partId);

      if (split) {
        // This is a split part - store it for segment viewing, don't auto-fill
        console.log('AdminPageClient: Clicked split part, setting viewingSegmentsForPart');
        setViewingSegmentsForPart(partId);
        setSelectedRouteId(null);
        // Don't set selectedPartId to prevent auto-fill
        return;
      }
    }

    // Normal part click logic
    setSelectedPartId(partId);
    setPartClickTrigger(prev => prev + 1); // Increment to force effect to run
    // Unselect any selected route when clicking a part
    setSelectedRouteId(null);
    setViewingSegmentsForPart(null);
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

  const handleSplitModeActivate = (partId: string, fieldTarget: 'starting' | 'ending') => {
    console.log(`AdminPageClient: Activating split mode for part ${partId}, target field: ${fieldTarget}`);
    setIsSplitMode(true);
    setSplittingPartId(partId);
    setSplittingFieldTarget(fieldTarget);
    // Clear any selected route or preview mode
    setSelectedRouteId(null);
    setPreviewRoute(null);
    setIsPreviewMode(false);
  };

  const handleSplitModeDeactivate = () => {
    console.log('AdminPageClient: Deactivating split mode');
    setIsSplitMode(false);
    setSplittingPartId(null);
    setSplittingFieldTarget(null);
  };

  const handleSplitPointClick = async (lng: number, lat: number) => {
    console.log('AdminPageClient: Split point clicked at:', lng, lat);

    if (!splittingPartId) {
      console.warn('No part ID set for splitting');
      return;
    }

    try {
      // Import the split action
      const { splitRailwayPart } = await import('@/lib/railwayPartSplitsActions');

      // Call the split action
      const result = await splitRailwayPart(splittingPartId, [lng, lat], user.id);

      if (result.success) {
        showSuccess(`Railway part ${splittingPartId} split successfully! Click a segment to select it.`);
        // DON'T deactivate split mode - keep it active so user can click a segment
        // Split mode will be deactivated when user clicks a segment
        // Trigger map refresh
        setRefreshTrigger(prev => prev + 1);
        // Notify child components that split completed
        setSplitCompletedTrigger(prev => prev + 1);
      } else {
        showError(`Error splitting part: ${result.error}`);
      }
    } catch (error) {
      console.error('Error splitting railway part:', error);
      showError(`Error splitting part: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
          isSplitMode={isSplitMode}
          splittingPartId={splittingPartId}
          onSplitModeActivate={handleSplitModeActivate}
          onSplitModeDeactivate={handleSplitModeDeactivate}
          splitCompletedTrigger={splitCompletedTrigger}
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
            isSplitMode={isSplitMode}
            splittingPartId={splittingPartId}
            viewingSegmentsForPart={viewingSegmentsForPart}
            onSplitPointClick={handleSplitPointClick}
          />
        </div>
      </main>
    </div>
  );
}
