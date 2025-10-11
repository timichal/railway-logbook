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
  onPartClick?: (partId: string) => void;
  onRouteSelect?: (routeId: string) => void;
  selectedRouteId?: string | null;
  previewRoute?: { partIds: string[], coordinates: [number, number][], railwayParts: RailwayPart[] } | null;
  selectedParts?: { startingId: string, endingId: string };
  refreshTrigger?: number;
}

export default function VectorAdminMapWrapper({
  className,
  onPartClick,
  onRouteSelect,
  selectedRouteId,
  previewRoute,
  selectedParts,
  refreshTrigger
}: VectorAdminMapWrapperProps) {
  return (
    <VectorAdminMap
      className={className}
      onPartClick={onPartClick}
      onRouteSelect={onRouteSelect}
      selectedRouteId={selectedRouteId}
      previewRoute={previewRoute}
      selectedParts={selectedParts}
      refreshTrigger={refreshTrigger}
    />
  );
}
