'use client';

import dynamic from 'next/dynamic';
import type { RailwayPart } from '@/lib/types';

// Dynamically import the map component to avoid SSR issues with MapLibre
const VectorAdminMap = dynamic(() => import('./VectorAdminMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="text-gray-600">Loading map...</div>
    </div>
  ),
});

interface VectorAdminMapWrapperProps {
  className?: string;
  onCoordinateClick?: (coordinate: [number, number]) => void;
  onRouteSelect?: (routeId: string) => void;
  selectedRouteId?: string | null;
  previewRoute?: { partIds: string[], coordinates: [number, number][], railwayParts: RailwayPart[] } | null;
  selectedCoordinates?: { startingCoordinate: [number, number] | null, endingCoordinate: [number, number] | null };
  refreshTrigger?: number;
  isEditingGeometry?: boolean;
  focusGeometry?: string | null;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
}

export default function VectorAdminMapWrapper({
  className,
  onCoordinateClick,
  onRouteSelect,
  selectedRouteId,
  previewRoute,
  selectedCoordinates,
  refreshTrigger,
  isEditingGeometry,
  focusGeometry,
  showSuccess,
  showError,
}: VectorAdminMapWrapperProps) {
  return (
    <VectorAdminMap
      className={className}
      onCoordinateClick={onCoordinateClick}
      onRouteSelect={onRouteSelect}
      selectedRouteId={selectedRouteId}
      previewRoute={previewRoute}
      selectedCoordinates={selectedCoordinates}
      refreshTrigger={refreshTrigger}
      isEditingGeometry={isEditingGeometry}
      focusGeometry={focusGeometry}
      showSuccess={showSuccess}
      showError={showError}
    />
  );
}
