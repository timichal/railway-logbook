import { useState, useEffect } from 'react';

interface UseResizableSidebarOptions {
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}

export function useResizableSidebar({
  initialWidth = 600,
  minWidth = 400,
  maxWidth = 1200
}: UseResizableSidebarOptions = {}) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(initialWidth);
  const [isResizing, setIsResizing] = useState<boolean>(false);

  const handleMouseDown = () => {
    setIsResizing(true);
  };

  // Handle resize drag
  useEffect(() => {
    if (!isResizing) return;

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
  }, [isResizing, minWidth, maxWidth]);

  return {
    sidebarWidth,
    isResizing,
    handleMouseDown
  };
}
