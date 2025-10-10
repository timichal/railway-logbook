'use client';

import React, { useState } from 'react';
import AdminRoutesTab from './AdminRoutesTab';
import AdminCreateRouteTab from './AdminCreateRouteTab';
import type { RailwayPart } from '@/lib/types';

interface AdminSidebarProps {
  selectedRouteId?: string | null;
  onRouteSelect?: (routeId: string) => void;
  selectedPartId?: string | null;
  onPreviewRoute?: (partIds: string[], coordinates: [number, number][], railwayParts: RailwayPart[]) => void;
  onCreateFormIdsChange?: (ids: {startingId: string, endingId: string}) => void;
  isPreviewMode?: boolean;
  onCancelPreview?: () => void;
  onSaveRoute?: (routeData: {track_id: string, name: string, description: string, usage_types: string[], primary_operator: string}) => void;
}

export default function AdminSidebar({ selectedRouteId, onRouteSelect, selectedPartId, onPreviewRoute, onCreateFormIdsChange, isPreviewMode, onCancelPreview, onSaveRoute }: AdminSidebarProps) {
  const [activeTab, setActiveTab] = useState<'routes' | 'create'>('routes');
  
  // State for create route form IDs
  const [createFormIds, setCreateFormIds] = useState({
    startingId: '',
    endingId: ''
  });

  // Handle selectedPartId to auto-fill form inputs
  React.useEffect(() => {
    if (selectedPartId && activeTab === 'create') {
      setCreateFormIds(prev => {
        // If both are empty or only first is empty, fill starting ID
        if (!prev.startingId) {
          return { ...prev, startingId: selectedPartId };
        }
        // If only ending ID is empty, fill ending ID
        else if (!prev.endingId) {
          return { ...prev, endingId: selectedPartId };
        }
        // Both are filled, do nothing
        return prev;
      });
    }
  }, [selectedPartId, activeTab]);

  // Notify parent when form IDs change
  React.useEffect(() => {
    if (onCreateFormIdsChange) {
      onCreateFormIdsChange(createFormIds);
    }
  }, [createFormIds, onCreateFormIdsChange]);

  return (
    <div className="w-96 bg-white border-r border-gray-200 flex flex-col">
      {/* Tab Headers */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('routes')}
          className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 ${
            activeTab === 'routes'
              ? 'border-blue-500 text-blue-600 bg-blue-50'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          Railway Routes
        </button>
        <button
          onClick={() => setActiveTab('create')}
          className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 ${
            activeTab === 'create'
              ? 'border-blue-500 text-blue-600 bg-blue-50'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          Create New
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'routes' && (
          <AdminRoutesTab
            selectedRouteId={selectedRouteId}
            onRouteSelect={onRouteSelect}
          />
        )}

        {activeTab === 'create' && (
          <AdminCreateRouteTab
            startingId={createFormIds.startingId}
            endingId={createFormIds.endingId}
            onStartingIdChange={(id) => setCreateFormIds(prev => ({ ...prev, startingId: id }))}
            onEndingIdChange={(id) => setCreateFormIds(prev => ({ ...prev, endingId: id }))}
            onPreviewRoute={onPreviewRoute}
            isPreviewMode={isPreviewMode}
            onCancelPreview={onCancelPreview}
            onSaveRoute={onSaveRoute}
          />
        )}
      </div>
    </div>
  );
}
