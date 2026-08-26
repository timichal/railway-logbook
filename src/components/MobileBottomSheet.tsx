"use client";

import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * The mobile sheet that carries the sidebar, anchored to the **bottom** of the map.
 *
 * Bottom rather than the old fixed top half for two reasons: that is where the thumb
 * is, and a sheet growing upward does not cover the part of the map that was just
 * tapped. It is a flex sibling of the map (not an overlay), so the map's own bottom
 * furniture — progress box, station search, MapLibre's attribution and controls —
 * stays visible above it instead of being buried.
 *
 * Four snap points: collapsed, a peek that shows the tab bar, half, and almost-full.
 * Drag the handle, or tap it to cycle; ArrowUp/ArrowDown move between snaps, since the
 * old resizer was mouse-only and left phones with no way to change the height at all.
 *
 * **The handle stays visible at the collapsed snap** — it is the sheet's only control
 * now that the navbar hamburger opens the menu instead of toggling the sidebar, so a
 * collapsed sheet must never be a state with no way back out of it.
 */

/** Peek shows the tab bar and the first line of content. */
const PEEK_PX = 120;
/** Fractions of the available height for the two larger snaps. */
const HALF_FRACTION = 0.5;
const FULL_FRACTION = 0.9;
/** Movement past this many pixels is a drag, not a tap on the handle. */
const DRAG_THRESHOLD_PX = 6;
/** Matches the `transition-[height]` duration below. */
const SNAP_TRANSITION_MS = 250;

interface MobileBottomSheetProps {
  /**
   * Called once the height has settled (after the snap transition), so the map can
   * `resize()` to the space it was left. Must be stable — it is an effect dependency.
   */
  onHeightSettled?: () => void;
  children: ReactNode;
}

function snapPointsFor(available: number): number[] {
  if (available <= 0) return [0, PEEK_PX];
  const peek = Math.min(PEEK_PX, available);
  const points = [0, peek, available * HALF_FRACTION, available * FULL_FRACTION];
  // A short viewport can collapse the larger snaps into one; keep them ascending
  // and distinct so the tap-to-cycle order never repeats a height.
  return [...new Set(points.map((p) => Math.round(Math.min(p, available))))].sort((a, b) => a - b);
}

function nearestSnap(height: number, snaps: number[]): number {
  return snaps.reduce((best, s) => (Math.abs(s - height) < Math.abs(best - height) ? s : best));
}

export default function MobileBottomSheet({ onHeightSettled, children }: MobileBottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const [height, setHeight] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startHeight: number; moved: boolean } | null>(null);

  // The parent is the flex column holding map + sheet, so its height is the budget.
  useEffect(() => {
    const parent = sheetRef.current?.parentElement;
    if (!parent) return;
    const update = () => setAvailable(parent.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  const snaps = snapPointsFor(available);

  // Open at half, and follow the budget when the viewport changes (rotation, the iOS
  // toolbar collapsing) rather than keeping a height that no longer fits.
  useEffect(() => {
    if (available <= 0) return;
    setHeight((current) => {
      if (current === null) return nearestSnap(available * HALF_FRACTION, snapPointsFor(available));
      const points = snapPointsFor(available);
      return Math.min(Math.max(current, points[0]), points[points.length - 1]);
    });
  }, [available]);

  // Tell the caller once the transition has finished. Re-armed on every height change,
  // so a drag that crosses several values only resizes the map at the end.
  useEffect(() => {
    if (dragging || height === null || !onHeightSettled) return;
    const timer = setTimeout(onHeightSettled, SNAP_TRANSITION_MS + 50);
    return () => clearTimeout(timer);
  }, [height, dragging, onHeightSettled]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (height === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startHeight: height, moved: false };
    setDragging(true);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = drag.startY - e.clientY;
    if (Math.abs(delta) > DRAG_THRESHOLD_PX) drag.moved = true;
    const min = snaps[0];
    const max = snaps[snaps.length - 1];
    setHeight(Math.min(Math.max(drag.startHeight + delta, min), max));
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    // A tap (no real movement) cycles upward through the snaps and wraps to collapsed.
    setHeight((current) => {
      if (current === null) return null;
      if (drag.moved) return nearestSnap(current, snaps);
      const index = snaps.indexOf(nearestSnap(current, snaps));
      return snaps[(index + 1) % snaps.length];
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    setHeight((current) => {
      if (current === null) return null;
      const index = snaps.indexOf(nearestSnap(current, snaps));
      const next = e.key === "ArrowUp" ? index + 1 : index - 1;
      return snaps[Math.min(Math.max(next, 0), snaps.length - 1)];
    });
  };

  return (
    <div
      ref={sheetRef}
      className="flex-shrink-0 bg-white border-t border-gray-200 flex flex-col sheet-slide-up"
    >
      <button
        type="button"
        aria-label="Resize panel"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        className="group w-full py-2 flex items-center justify-center touch-none cursor-grab active:cursor-grabbing flex-shrink-0"
      >
        <span className="w-10 h-1.5 rounded-full bg-gray-400 transition-colors group-hover:bg-gray-500 group-active:bg-gray-600" />
      </button>
      <div
        className={`min-h-0 overflow-hidden flex flex-col ${
          dragging ? "" : "transition-[height] duration-250 ease-out"
        }`}
        style={{ height: height === null ? `${HALF_FRACTION * 100}%` : `${height}px` }}
      >
        {children}
      </div>
    </div>
  );
}
