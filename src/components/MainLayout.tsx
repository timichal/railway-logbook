'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { User } from '@/lib/authActions';
import Navbar from './Navbar';
import type { ActiveTab } from './UserSidebar';
import { useResizableSidebar } from '@/hooks/useResizableSidebar';

// Dynamically import the map component to avoid SSR issues with MapLibre
const VectorRailwayMap = dynamic(() => import('./VectorRailwayMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="text-gray-600">Loading map...</div>
    </div>
  ),
});

interface MainLayoutProps {
  user: User | null;
  onLogout: () => void;
  initialSelectedCountries: string[];
}

export default function MainLayout({ user, onLogout, initialSelectedCountries }: MainLayoutProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('routes');
  const { sidebarWidth, isResizing, handleMouseDown } = useResizableSidebar();

  return (
    <>
      <Navbar
        user={user}
        onLogout={onLogout}
        onOpenHowTo={() => setActiveTab('howto')}
        onOpenNotes={() => setActiveTab('notes')}
      />

      <main className="flex-1 overflow-hidden">
        <VectorRailwayMap
          className="w-full h-full"
          user={user}
          initialSelectedCountries={initialSelectedCountries}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          sidebarWidth={sidebarWidth}
          onSidebarResize={handleMouseDown}
          isResizing={isResizing}
        />
      </main>
    </>
  );
}
