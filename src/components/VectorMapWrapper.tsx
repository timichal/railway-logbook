'use client';

import dynamic from 'next/dynamic';
import type { User } from '@/lib/authActions';
import type { ActiveTab } from './UserSidebar';

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
  user: User | null;
  initialSelectedCountries: string[];
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  sidebarWidth: number;
  onSidebarResize: () => void;
  isResizing: boolean;
}

export default function VectorMapWrapper({
  className,
  user,
  initialSelectedCountries,
  activeTab,
  setActiveTab,
  sidebarWidth,
  onSidebarResize,
  isResizing
}: VectorMapWrapperProps) {
  return (
    <VectorRailwayMap
      className={className}
      user={user}
      initialSelectedCountries={initialSelectedCountries}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      sidebarWidth={sidebarWidth}
      onSidebarResize={onSidebarResize}
      isResizing={isResizing}
    />
  );
}
