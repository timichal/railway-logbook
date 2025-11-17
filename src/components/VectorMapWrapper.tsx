'use client';

import dynamic from 'next/dynamic';

// Dynamically import the map component to avoid SSR issues with MapLibre
const VectorRailwayMap = dynamic(() => import('./VectorRailwayMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="text-gray-600">Loading map...</div>
    </div>
  ),
});

interface VectorMapWrapperProps {
  className?: string;
  userId: number;
  initialSelectedCountries: string[];
}

export default function VectorMapWrapper({ className, userId, initialSelectedCountries }: VectorMapWrapperProps) {
  return <VectorRailwayMap className={className} userId={userId} initialSelectedCountries={initialSelectedCountries} />;
}
