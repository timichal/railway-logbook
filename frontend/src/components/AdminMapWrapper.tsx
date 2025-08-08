'use client';

import dynamic from 'next/dynamic';
import type { RailwayPart } from '@/lib/types';

// Dynamically import AdminMap with no SSR to avoid window reference errors
const AdminMap = dynamic(() => import('./AdminMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
        <p className="text-gray-600">Loading optimized admin map...</p>
      </div>
    </div>
  )
});

interface AdminMapWrapperProps {
  className?: string;
  selectedRouteId?: string | null;
  onRouteSelect?: (routeId: string) => void;
  onPartClick?: (partId: string) => void;
  previewRoute?: {partIds: string[], coordinates: [number, number][], railwayParts: RailwayPart[]} | null;
  selectedParts?: {startingId: string, endingId: string};
  isPreviewMode?: boolean;
}

export default function AdminMapWrapper({ className, selectedRouteId, onRouteSelect, onPartClick, previewRoute, selectedParts, isPreviewMode }: AdminMapWrapperProps) {
  return (
    <AdminMap 
      className={className}
      selectedRouteId={selectedRouteId}
      onRouteSelect={onRouteSelect}
      onPartClick={onPartClick}
      previewRoute={previewRoute}
      selectedParts={selectedParts}
      isPreviewMode={isPreviewMode}
    />
  );
}