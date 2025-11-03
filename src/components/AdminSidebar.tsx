'use client';

import React, { useState } from 'react';
import AdminRoutesTab from './AdminRoutesTab';
import AdminCreateRouteTab from './AdminCreateRouteTab';
import type { RailwayPart } from '@/lib/types';
import { useToast } from '@/lib/toast';

interface AdminSidebarProps {
  selectedRouteId?: string | null;
  onRouteSelect?: (routeId: string) => void;
  selectedPartId?: string | null;
  partClickTrigger?: number;
  onPreviewRoute?: (partIds: string[], coordinates: [number, number][], railwayParts: RailwayPart[]) => void;
  onCreateFormIdsChange?: (ids: {startingId: string, endingId: string}) => void;
  isPreviewMode?: boolean;
  onCancelPreview?: () => void;
  onSaveRoute?: (routeData: {from_station: string, to_station: string, description: string, usage_type: 0 | 1, track_number: string, frequency: string[], link: string}) => void;
  onFormReset?: () => void;
  onRouteDeleted?: () => void;
  onRouteUpdated?: () => void;
  onEditingGeometryChange?: (trackId: string | null) => void;
  onRouteFocus?: (geometry: string) => void;
  sidebarWidth?: number;
}

export default function AdminSidebar({ selectedRouteId, onRouteSelect, selectedPartId, partClickTrigger, onPreviewRoute, onCreateFormIdsChange, isPreviewMode, onCancelPreview, onSaveRoute, onFormReset, onRouteDeleted, onRouteUpdated, onEditingGeometryChange, onRouteFocus, sidebarWidth = 400 }: AdminSidebarProps) {
  const { showError } = useToast();
  const [activeTab, setActiveTab] = useState<'routes' | 'create'>('routes');
  const [editingGeometryForTrackId, setEditingGeometryForTrackId] = useState<string | null>(null);

  // Switch to create tab when a part is clicked
  React.useEffect(() => {
    if (selectedPartId) {
      setActiveTab('create');
    }
  }, [selectedPartId, partClickTrigger]);

  // Switch to routes tab when a route is selected
  React.useEffect(() => {
    if (selectedRouteId) {
      setActiveTab('routes');
      // Clear the local form IDs when switching to routes
      setCreateFormIds({ startingId: '', endingId: '' });
    }
  }, [selectedRouteId]);
  
  // State for create route form IDs
  const [createFormIds, setCreateFormIds] = useState({
    startingId: '',
    endingId: ''
  });

  // Handle selectedPartId to auto-fill form inputs
  React.useEffect(() => {
    if (selectedPartId) {
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
  }, [selectedPartId, partClickTrigger]); // Added partClickTrigger to force effect to run

  // Notify parent when form IDs change
  React.useEffect(() => {
    if (onCreateFormIdsChange) {
      onCreateFormIdsChange(createFormIds);
    }
  }, [createFormIds, onCreateFormIdsChange]);

  // Notify parent when editing geometry state changes
  React.useEffect(() => {
    if (onEditingGeometryChange) {
      onEditingGeometryChange(editingGeometryForTrackId);
    }
  }, [editingGeometryForTrackId, onEditingGeometryChange]);

  // Create a callback to handle resetting IDs that the child can call
  const handleResetIds = React.useCallback(() => {
    setCreateFormIds({ startingId: '', endingId: '' });
    // Also notify parent if needed
    if (onFormReset) {
      onFormReset();
    }
  }, [onFormReset]);

  // Handle edit geometry button click
  const handleEditGeometry = React.useCallback(async (trackId: string) => {
    console.log('Edit geometry for track:', trackId);
    setEditingGeometryForTrackId(trackId);
    setActiveTab('create');

    // Fetch the route details to get starting_part_id and ending_part_id
    try {
      const { getRailwayRoute } = await import('@/lib/admin-route-actions');
      const routeDetail = await getRailwayRoute(trackId);

      // Prefill the starting/ending part IDs if they exist
      if (routeDetail.starting_part_id && routeDetail.ending_part_id) {
        setCreateFormIds({
          startingId: routeDetail.starting_part_id.toString(),
          endingId: routeDetail.ending_part_id.toString()
        });
      } else {
        setCreateFormIds({ startingId: '', endingId: '' });
      }
    } catch (error) {
      console.error('Error fetching route details for geometry edit:', error);
      showError(`Failed to load route details: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setCreateFormIds({ startingId: '', endingId: '' });
    }

    // Unselect the route so it doesn't interfere with the map
    if (onRouteSelect) {
      onRouteSelect('');
    }
  }, [onRouteSelect]);

  // Handle cancel geometry edit
  const handleCancelGeometryEdit = React.useCallback(() => {
    console.log('Cancel geometry edit');
    setEditingGeometryForTrackId(null);
    setActiveTab('routes');
    setCreateFormIds({ startingId: '', endingId: '' });
  }, []);

  return (
    <div style={{ width: `${sidebarWidth}px` }} className="bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
      {/* Tab Headers */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => {
            setActiveTab('routes');
            // Clear form IDs when manually switching to Railway Routes
            setCreateFormIds({ startingId: '', endingId: '' });
          }}
          className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 ${
            activeTab === 'routes'
              ? 'border-blue-500 text-blue-600 bg-blue-50'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          Railway Routes
        </button>
        <button
          onClick={() => {
            setActiveTab('create');
            // Unselect any selected route when switching to Create New
            if (onRouteSelect) {
              onRouteSelect('');
            }
          }}
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
            onRouteDeleted={onRouteDeleted}
            onRouteUpdated={onRouteUpdated}
            onEditGeometry={handleEditGeometry}
            onRouteFocus={onRouteFocus}
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
            onFormReset={handleResetIds}
            editingGeometryForTrackId={editingGeometryForTrackId}
            onGeometryEditComplete={() => {
              setEditingGeometryForTrackId(null);
              setActiveTab('routes');
              // Trigger map refresh after geometry edit
              if (onRouteUpdated) {
                onRouteUpdated();
              }
            }}
            onCancelGeometryEdit={handleCancelGeometryEdit}
          />
        )}
      </div>
    </div>
  );
}
