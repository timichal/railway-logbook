'use client';

import { useRef, useCallback } from 'react';
import 'leaflet/dist/leaflet.css';
import { RailwayPart } from '@/lib/types';
import { useMapInitialization } from '@/lib/map/useMapInitialization';
import { useLayerManagement } from '@/lib/map/useLayerManagement';
import { useRailwayDataLoader } from '@/lib/map/useRailwayDataLoader';
import { useRailwayRoutes } from '@/lib/map/useRailwayRoutes';
import LayerControls from './LayerControls';
import MapLoadingIndicator from './MapLoadingIndicator';

interface AdminMapProps {
  className?: string;
  selectedRouteId?: string | null;
  onRouteSelect?: (routeId: string) => void;
  onPartClick?: (partId: string) => void;
  previewRoute?: {partIds: string[], coordinates: [number, number][], railwayParts: RailwayPart[]} | null;
  selectedParts?: {startingId: string, endingId: string};
  isPreviewMode?: boolean;
  refreshTrigger?: number;
}

export default function AdminMap({
  className = '',
  selectedRouteId,
  onRouteSelect,
  onPartClick,
  previewRoute,
  selectedParts,
  isPreviewMode,
  refreshTrigger
}: AdminMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);

  // Load and render railway parts data
  // Note: We need to define these hooks before useMapInitialization so we can pass the callbacks
  const railwayDataLoaderRefs = useRef({
    loadDataForViewport: () => {},
    debouncedLoadData: () => {}
  });

  const railwayRoutesRefs = useRef({
    loadAllRoutes: () => {}
  });

  // Stable callbacks for map initialization
  const handleViewportChange = useCallback(() => {
    railwayDataLoaderRefs.current.debouncedLoadData();
  }, []);

  const handleInitialLoad = useCallback(() => {
    railwayDataLoaderRefs.current.loadDataForViewport();
  }, []);

  const handleRoutesLoad = useCallback(() => {
    railwayRoutesRefs.current.loadAllRoutes();
  }, []);

  // Initialize map and layer groups
  const {
    mapInstanceRef,
    railwayLayerGroupRef,
    routesLayerGroupRef,
    previewLayerGroupRef,
    debounceTimeoutRef
  } = useMapInitialization(
    mapRef,
    true,
    true,
    handleViewportChange,
    handleInitialLoad,
    handleRoutesLoad
  );

  // Manage layer visibility
  const {
    showPartsLayer,
    showRoutesLayer,
    togglePartsLayer,
    toggleRoutesLayer
  } = useLayerManagement(
    mapInstanceRef,
    railwayLayerGroupRef,
    routesLayerGroupRef,
    previewLayerGroupRef,
    isPreviewMode
  );

  // Load and render railway parts data
  const {
    isLoading,
    loadDataForViewport,
    debouncedLoadData
  } = useRailwayDataLoader(
    mapInstanceRef,
    railwayLayerGroupRef,
    routesLayerGroupRef,
    previewLayerGroupRef,
    debounceTimeoutRef,
    selectedParts,
    onPartClick
  );

  // Update refs so useMapInitialization can access them
  railwayDataLoaderRefs.current.loadDataForViewport = loadDataForViewport;
  railwayDataLoaderRefs.current.debouncedLoadData = debouncedLoadData;

  // Load and render railway routes
  const { loadAllRoutes } = useRailwayRoutes(
    mapInstanceRef,
    routesLayerGroupRef,
    previewLayerGroupRef,
    selectedRouteId,
    previewRoute,
    refreshTrigger,
    onRouteSelect
  );

  // Update refs so useMapInitialization can access them
  railwayRoutesRefs.current.loadAllRoutes = loadAllRoutes;

  return (
    <div className={`${className} relative`}>
      <div ref={mapRef} className="w-full h-full" />

      <LayerControls
        showPartsLayer={showPartsLayer}
        showRoutesLayer={showRoutesLayer}
        onTogglePartsLayer={togglePartsLayer}
        onToggleRoutesLayer={toggleRoutesLayer}
      />

      <MapLoadingIndicator isLoading={isLoading} />
    </div>
  );
}
