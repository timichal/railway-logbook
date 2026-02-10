import { useState, useEffect, useCallback } from 'react';

interface UseResizableSidebarOptions {
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  isMobile?: boolean;
}

export function useResizableSidebar({
  initialWidth = 600,
  minWidth = 400,
  maxWidth = 1200,
  isMobile = false
}: UseResizableSidebarOptions = {}) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(initialWidth);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(!isMobile);

  // Auto-close sidebar when entering mobile, auto-open on desktop
  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  const handleMouseDown = () => {
    if (isMobile) return;
    setIsResizing(true);
  };

  // Handle resize drag
  useEffect(() => {
    if (!isResizing || isMobile) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      // Constrain between min and max
      if (newWidth >= minWidth && newWidth <= maxWidth) {
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
  }, [isResizing, isMobile, minWidth, maxWidth]);

  return {
    sidebarWidth,
    isResizing,
    handleMouseDown,
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar
  };
}
