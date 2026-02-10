'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { User } from '@/lib/authActions';
import Navbar from './Navbar';
import type { ActiveTab } from './UserSidebar';
import { useResizableSidebar } from '@/hooks/useResizableSidebar';
import { useIsMobile } from '@/hooks/useIsMobile';

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
  const isMobile = useIsMobile();
  const { sidebarWidth, isResizing, handleMouseDown, sidebarOpen, toggleSidebar } = useResizableSidebar({ isMobile });

  // Wrap logout to also switch to Route Logger tab
  const handleLogout = () => {
    setActiveTab('routes');
    onLogout();
  };

  // Handle successful login/register - switch to Route Logger tab
  const handleAuthSuccess = () => {
    setActiveTab('routes');
  };

  return (
    <>
      <Navbar
        user={user}
        onLogout={handleLogout}
        onAuthSuccess={handleAuthSuccess}
        onOpenHowTo={() => setActiveTab('howto')}
        onOpenNotes={() => setActiveTab('notes')}
        isMobile={isMobile}
        onToggleSidebar={toggleSidebar}
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
          isMobile={isMobile}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
        />
      </main>
    </>
  );
}
