import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

interface UseResizableSidebarOptions {
  /** localStorage key the width is kept under once the user has dragged it. */
  storageKey: string;
  minWidth?: number;
  maxWidth?: number;
  isMobile?: boolean;
}

/**
 * Map the sidebar always leaves beside it. A stored width is a pixel count chosen
 * in whatever window it was dragged in; without this cap, 1100px dragged on a big
 * monitor would cover a laptop's whole window — the resize handle included, so
 * there would be no dragging it back.
 */
const MIN_MAP_WIDTH = 360;

/** A width in px as CSS, capped to leave `MIN_MAP_WIDTH` of map. */
function cappedWidth(width: number): string {
  return `min(${width}px, calc(100vw - ${MIN_MAP_WIDTH}px))`;
}

/**
 * Until the user drags the sidebar it follows the viewport: 600px left a 915px-wide
 * window about 315px of map. A CSS expression rather than a number read from
 * `window`, because the admin sidebar is server-rendered and has to paint the same
 * width on both sides of hydration.
 */
function defaultWidth(minWidth: number): string {
  return `clamp(${minWidth}px, 40vw, 600px)`;
}

/**
 * The stored widths, read from localStorage once per key and then kept here. It is
 * also where a width lives when storage refuses the write (private mode, blocked
 * site data): the resize then lasts until reload instead of snapping back.
 */
const widths = new Map<string, number | null>();
// Writes from this tab; the `storage` event only reports other tabs'.
const listeners = new Set<() => void>();

function readStoredWidth(key: string): number | null {
  const cached = widths.get(key);
  if (cached !== undefined) return cached;
  let width: number | null = null;
  try {
    const value = Number(localStorage.getItem(key));
    if (Number.isFinite(value) && value > 0) width = value;
  } catch {
    // Unreadable storage is the same as nothing stored.
  }
  widths.set(key, width);
  return width;
}

function writeStoredWidth(key: string, width: number): void {
  widths.set(key, width);
  try {
    localStorage.setItem(key, String(width));
  } catch (error) {
    console.warn("Failed to save sidebar width:", error);
  }
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    // A null key is another tab clearing storage.
    if (event.key === null) widths.clear();
    else widths.delete(event.key);
    onStoreChange();
  };
  listeners.add(onStoreChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function useResizableSidebar({
  storageKey,
  minWidth = 360,
  maxWidth = 1200,
  isMobile = false,
}: UseResizableSidebarOptions) {
  // During hydration this is the server snapshot (null, the default). React swaps in
  // the stored width in a passive effect, so on the server-rendered admin page the
  // default can show for a frame first. The main map's sidebar is inside an
  // `ssr: false` subtree and mounts after the swap.
  const storedWidth = useSyncExternalStore(
    subscribe,
    () => readStoredWidth(storageKey),
    () => null,
  );
  // The width mid-drag; stored only on release, not on every mousemove. Mirrored in
  // a ref for the mouseup handler, which can belong to a later run of the drag effect
  // than the mousemoves did (it re-runs if `isMobile` flips mid-drag).
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragWidthRef = useRef<number | null>(null);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(!isMobile);

  // Auto-close sidebar when entering mobile, auto-open on desktop. Adjusted during
  // render rather than in an effect: an effect runs after paint, so on a phone the
  // open desktop sidebar would be painted once before closing again.
  const [prevIsMobile, setPrevIsMobile] = useState<boolean>(isMobile);
  if (prevIsMobile !== isMobile) {
    setPrevIsMobile(isMobile);
    setSidebarOpen(!isMobile);
  }

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const handleMouseDown = () => {
    if (isMobile) return;
    setIsResizing(true);
  };

  // Handle resize drag
  useEffect(() => {
    if (!isResizing || isMobile) return;

    const handleMouseMove = (e: MouseEvent) => {
      const width = Math.min(maxWidth, Math.max(minWidth, e.clientX));
      dragWidthRef.current = width;
      setDragWidth(width);
    };

    const handleMouseUp = () => {
      if (dragWidthRef.current !== null) writeStoredWidth(storageKey, dragWidthRef.current);
      dragWidthRef.current = null;
      setDragWidth(null);
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, isMobile, minWidth, maxWidth, storageKey]);

  // Bounds applied on read too: a stored width may predate them, or be hand-edited.
  const width =
    dragWidth ??
    (storedWidth === null ? null : Math.min(maxWidth, Math.max(minWidth, storedWidth)));

  return {
    /** A CSS width. */
    sidebarWidth: width === null ? defaultWidth(minWidth) : cappedWidth(width),
    isResizing,
    handleMouseDown,
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar,
  };
}
