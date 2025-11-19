'use client';

import React, { useState } from 'react';
import AdminRoutesTab from './AdminRoutesTab';
import AdminCreateRouteTab from './AdminCreateRouteTab';
import type { RailwayPart } from '@/lib/types';
import { useToast } from '@/lib/toast';

interface AdminSidebarProps {
  selectedRouteId?: string | null;
  onRouteSelect?: (routeId: string) => void;
  selectedCoordinate?: [number, number] | null;
  coordinateClickTrigger?: number;
  onPreviewRoute?: (
    partIds: string[],
    coordinates: [number, number][],
    railwayParts: RailwayPart[],
    startCoordinate: [number, number],
    endCoordinate: [number, number]
  ) => void;
  onCreateFormCoordinatesChange?: (coords: {startingCoordinate: [number, number] | null, endingCoordinate: [number, number] | null}) => void;
  isPreviewMode?: boolean;
  onCancelPreview?: () => void;
  onSaveRoute?: (routeData: {from_station: string, to_station: string, description: string, usage_type: 0 | 1, track_number: string, frequency: string[], link: string}) => void;
  onFormReset?: () => void;
  onRouteDeleted?: () => void;
  onRouteUpdated?: () => void;
  onEditingGeometryChange?: (trackId: string | null) => void;
  onRouteFocus?: (geometry: string) => void;
  sidebarWidth?: number;
  onRefreshMap?: () => void;
  showError?: (message: string) => void;
  showSuccess?: (message: string) => void;
}

export default function AdminSidebar({ selectedRouteId, onRouteSelect, selectedCoordinate, coordinateClickTrigger, onPreviewRoute, onCreateFormCoordinatesChange, isPreviewMode, onCancelPreview, onSaveRoute, onFormReset, onRouteDeleted, onRouteUpdated, onEditingGeometryChange, onRouteFocus, sidebarWidth = 400, onRefreshMap, showError: showErrorProp, showSuccess: showSuccessProp }: AdminSidebarProps) {
  const { showError: showErrorToast } = useToast();
  const showError = showErrorProp || showErrorToast;
  const [activeTab, setActiveTab] = useState<'routes' | 'create'>('routes');
  const [editingGeometryForTrackId, setEditingGeometryForTrackId] = useState<string | null>(null);
  const [editingRouteInfo, setEditingRouteInfo] = useState<{ from_station: string, to_station: string, track_number: string } | null>(null);

  // Switch to create tab when a coordinate is clicked
  React.useEffect(() => {
    if (selectedCoordinate) {
      setActiveTab('create');
    }
  }, [selectedCoordinate, coordinateClickTrigger]);

  // Switch to routes tab when a route is selected
  React.useEffect(() => {
    if (selectedRouteId) {
      setActiveTab('routes');
      // Clear the local form coordinates when switching to routes
      setCreateFormCoordinates({ startingCoordinate: null, endingCoordinate: null });
    }
  }, [selectedRouteId]);

  // State for create route form coordinates
  const [createFormCoordinates, setCreateFormCoordinates] = useState<{
    startingCoordinate: [number, number] | null;
    endingCoordinate: [number, number] | null;
  }>({
    startingCoordinate: null,
    endingCoordinate: null
  });

  // Handle selectedCoordinate to auto-fill form inputs
  React.useEffect(() => {
    if (selectedCoordinate) {
      setCreateFormCoordinates(prev => {
        // If starting coordinate is empty, fill it
        if (!prev.startingCoordinate) {
          return { ...prev, startingCoordinate: selectedCoordinate };
        }
        // If ending coordinate is empty, fill it
        else if (!prev.endingCoordinate) {
          return { ...prev, endingCoordinate: selectedCoordinate };
        }
        // Both are filled, do nothing
        return prev;
      });
    }
  }, [selectedCoordinate, coordinateClickTrigger]);

  // Notify parent when form coordinates change
  React.useEffect(() => {
    if (onCreateFormCoordinatesChange) {
      onCreateFormCoordinatesChange(createFormCoordinates);
    }
  }, [createFormCoordinates, onCreateFormCoordinatesChange]);

  // Notify parent when editing geometry state changes
  React.useEffect(() => {
    if (onEditingGeometryChange) {
      onEditingGeometryChange(editingGeometryForTrackId);
    }
  }, [editingGeometryForTrackId, onEditingGeometryChange]);

  // Create a callback to handle resetting coordinates that the child can call
  const handleResetCoordinates = React.useCallback(() => {
    setCreateFormCoordinates({ startingCoordinate: null, endingCoordinate: null });
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

    // Notify parent component about editing state
    if (onEditingGeometryChange) {
      onEditingGeometryChange(trackId);
    }

    // Fetch the route details to get starting_coordinate and ending_coordinate
    try {
      const { getRailwayRoute } = await import('@/lib/adminRouteActions');
      const routeDetail = await getRailwayRoute(trackId);

      console.log('Route detail:', routeDetail);
      console.log('Starting coordinate:', routeDetail.starting_coordinate);
      console.log('Ending coordinate:', routeDetail.ending_coordinate);

      // Store route info for display
      setEditingRouteInfo({
        from_station: routeDetail.from_station,
        to_station: routeDetail.to_station,
        track_number: routeDetail.track_number || ''
      });

      // Prefill the starting/ending coordinates if they exist
      if (routeDetail.starting_coordinate && routeDetail.ending_coordinate) {
        setCreateFormCoordinates({
          startingCoordinate: routeDetail.starting_coordinate,
          endingCoordinate: routeDetail.ending_coordinate
        });

        // Also notify parent of the coordinate changes
        if (onCreateFormCoordinatesChange) {
          onCreateFormCoordinatesChange({
            startingCoordinate: routeDetail.starting_coordinate,
            endingCoordinate: routeDetail.ending_coordinate
          });
        }
      } else {
        console.warn('Route does not have starting/ending coordinates stored');
        setCreateFormCoordinates({ startingCoordinate: null, endingCoordinate: null });
      }

    } catch (error) {
      console.error('Error fetching route details for geometry edit:', error);
      showError(`Failed to load route details: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setCreateFormCoordinates({ startingCoordinate: null, endingCoordinate: null });
    }

    // Select the route to highlight it
    if (onRouteSelect) {
      onRouteSelect(trackId);
    }
  }, [onRouteSelect, onEditingGeometryChange, onCreateFormCoordinatesChange, onRouteFocus, showError]);

  // Handle cancel geometry edit
  const handleCancelGeometryEdit = React.useCallback(() => {
    console.log('Cancel geometry edit');
    setEditingGeometryForTrackId(null);
    setEditingRouteInfo(null);
    setActiveTab('routes');
    setCreateFormCoordinates({ startingCoordinate: null, endingCoordinate: null });

    // Notify parent component
    if (onEditingGeometryChange) {
      onEditingGeometryChange(null);
    }

    // Unselect the route
    if (onRouteSelect) {
      onRouteSelect('');
    }
  }, [onEditingGeometryChange, onRouteSelect]);

  return (
    <div style={{ width: `${sidebarWidth}px` }} className="bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
      {/* Tab Headers */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => {
            setActiveTab('routes');
            // Clear form coordinates when manually switching to Railway Routes
            setCreateFormCoordinates({ startingCoordinate: null, endingCoordinate: null });
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
            startingCoordinate={createFormCoordinates.startingCoordinate}
            endingCoordinate={createFormCoordinates.endingCoordinate}
            onStartingCoordinateChange={(coord) => setCreateFormCoordinates(prev => ({ ...prev, startingCoordinate: coord }))}
            onEndingCoordinateChange={(coord) => setCreateFormCoordinates(prev => ({ ...prev, endingCoordinate: coord }))}
            onPreviewRoute={onPreviewRoute}
            isPreviewMode={isPreviewMode}
            onCancelPreview={onCancelPreview}
            onSaveRoute={onSaveRoute}
            onFormReset={handleResetCoordinates}
            editingGeometryForTrackId={editingGeometryForTrackId}
            editingRouteInfo={editingRouteInfo}
            onGeometryEditComplete={() => {
              setEditingGeometryForTrackId(null);
              setEditingRouteInfo(null);
              setActiveTab('routes');

              // Trigger map refresh after geometry edit
              // Use setTimeout to allow showRoutesLayer state to update first
              if (onRouteUpdated) {
                setTimeout(() => {
                  onRouteUpdated();
                }, 50);
              }
            }}
            onCancelGeometryEdit={handleCancelGeometryEdit}
            onRefreshMap={onRefreshMap}
          />
        )}
      </div>
    </div>
  );
}
