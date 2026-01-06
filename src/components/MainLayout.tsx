'use client';

import { useState, useEffect, useCallback } from 'react';
import type { User } from '@/lib/authActions';
import Navbar from './Navbar';
import VectorMapWrapper from './VectorMapWrapper';
import type { ActiveTab } from './UserSidebar';

interface MainLayoutProps {
  user: User | null;
  onLogout: () => void;
  initialSelectedCountries: string[];
}

export default function MainLayout({ user, onLogout, initialSelectedCountries }: MainLayoutProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('routes');
  const [sidebarWidth, setSidebarWidth] = useState<number>(600);
  const [isResizing, setIsResizing] = useState<boolean>(false);

  const handleOpenHowTo = useCallback(() => {
    setActiveTab('howto');
  }, []);

  const handleOpenNotes = useCallback(() => {
    setActiveTab('notes');
  }, []);

  const handleMouseDown = () => {
    setIsResizing(true);
  };

  // Handle resize drag
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      // Constrain between 400px and 1200px
      if (newWidth >= 400 && newWidth <= 1200) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  return (
    <>
      <Navbar
        user={user}
        onLogout={onLogout}
        onOpenHowTo={handleOpenHowTo}
        onOpenNotes={handleOpenNotes}
        showArticleButtons={true}
      />

      <main className="flex-1 overflow-hidden">
        <VectorMapWrapper
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
