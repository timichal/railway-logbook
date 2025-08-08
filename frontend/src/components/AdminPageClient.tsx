'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import AdminMapWrapper from '@/components/AdminMapWrapper';
import AdminSidebar from '@/components/AdminSidebar';
import { logout } from '@/lib/auth-actions';
import { saveRailwayRoute } from '@/lib/route-save-actions';
import type { RailwayPart } from '@/lib/types';

interface AdminPageClientProps {
  user: {
    id: number;
    name?: string;
    email: string;
  };
}

export default function AdminPageClient({ user }: AdminPageClientProps) {
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [previewRoute, setPreviewRoute] = useState<{partIds: string[], coordinates: [number, number][], railwayParts: RailwayPart[]} | null>(null);
  const [createFormIds, setCreateFormIds] = useState<{startingId: string, endingId: string}>({startingId: '', endingId: ''});
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);

  const handleRouteSelect = (routeId: string) => {
    setSelectedRouteId(routeId);
  };

  const handlePartClick = (partId: string) => {
    setSelectedPartId(partId);
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

  const handleSaveRoute = async (routeData: {track_id: string, name: string, description: string, usage_types: string[], primary_operator: string}) => {
    console.log('AdminPageClient: Save route requested', routeData);
    
    if (!previewRoute) {
      console.error('AdminPageClient: No preview route to save');
      alert('Error: No route preview available to save');
      return;
    }
    
    try {
      const trackId = await saveRailwayRoute(routeData, previewRoute, previewRoute.railwayParts);
      console.log('AdminPageClient: Route saved successfully with track_id:', trackId);
      
      // Clear preview mode and show success message
      setPreviewRoute(null);
      setIsPreviewMode(false);
      
      alert(`Route "${routeData.name}" saved successfully!\nTrack ID: ${trackId}`);
      
      // Optionally clear the form or redirect
      // You might want to reset form fields here
      
    } catch (error) {
      console.error('AdminPageClient: Error saving route:', error);
      alert(`Error saving route: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleCreateFormIdsChange = (ids: {startingId: string, endingId: string}) => {
    setCreateFormIds(ids);
  };

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

      <main className="flex-1 overflow-hidden flex">
        <AdminSidebar
          selectedRouteId={selectedRouteId}
          onRouteSelect={handleRouteSelect}
          selectedPartId={selectedPartId}
          onPreviewRoute={handlePreviewRoute}
          onCreateFormIdsChange={handleCreateFormIdsChange}
          isPreviewMode={isPreviewMode}
          onCancelPreview={handleCancelPreview}
          onSaveRoute={handleSaveRoute}
        />
        <div className="flex-1 overflow-hidden">
          <AdminMapWrapper
            className="w-full h-full"
            selectedRouteId={selectedRouteId}
            onRouteSelect={handleRouteSelect}
            onPartClick={handlePartClick}
            previewRoute={previewRoute}
            selectedParts={{startingId: createFormIds.startingId, endingId: createFormIds.endingId}}
            isPreviewMode={isPreviewMode}
          />
        </div>
      </main>
    </div>
  );
}
