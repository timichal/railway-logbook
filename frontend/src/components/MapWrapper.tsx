'use client';

import dynamic from 'next/dynamic';
import { GeoJSONFeatureCollection } from '@/lib/types';

// Dynamically import RailwayMap with no SSR to avoid window reference errors
const RailwayMap = dynamic(() => import('./RailwayMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
        <p className="text-gray-600">Loading map...</p>
      </div>
    </div>
  )
});

interface MapWrapperProps {
  className?: string;
  geoJsonData: GeoJSONFeatureCollection;
}

export default function MapWrapper({ className, geoJsonData }: MapWrapperProps) {
  return <RailwayMap className={className} geoJsonData={geoJsonData} />;
}