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
 * collapsed sheet must never be a state with no way back out of it. Collapsed, it also
 * grows a caption (`collapsedLabel`) and a chevron: a bare grey bar lying on the map
 * says that something is there but not what, and that is the one state where the sheet
 * has to introduce itself. Expanded, the caption goes away again and the band shrinks
 * back to the grabber — the content below it is then saying what the sheet is.
 *
 * **It overlaps the map by `SHEET_OVERLAP_PX`.** The rounded top corners are what make
 * the thing read as a sheet rather than as the bottom half of the page, and a rounded
 * corner only shows if there is something behind it — flush against the map, the
 * corners revealed `body`'s white and the radius was invisible. The negative margin is
 * given straight back to the map (it is the `flex-1` sibling), so the map loses no
 * height for it; the cost is that MapLibre's own bottom controls have to clear the
 * seam, which `globals.css` does by selecting the map pane that this sheet follows.
 *
 * **The scrim is the drag's other piece of feedback.** Past the half snap the map
 * behind dims in proportion to how far the sheet has come, so a nearly-full sheet
 * reads as covering the map instead of as a white box sitting on it — and tapping the
 * dimmed part is the quickest way back down. It is `absolute`, drawn upward from the
 * sheet's own top edge, so `main`'s `overflow-hidden` clips it to the map pane and the
 * navbar above is never dimmed.
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
/**
 * How far the sheet's rounded top edge sits over the map. Mirrored in `globals.css`,
 * which lifts MapLibre's bottom control stacks clear of the seam by the same amount.
 */
const SHEET_OVERLAP_PX = 12;
/** How dark the map behind goes at the topmost snap. */
const MAX_SCRIM_OPACITY = 0.4;

interface MobileBottomSheetProps {
  /**
   * Called once the height has settled (after the snap transition), so the map can
   * `resize()` to the space it was left. Must be stable — it is an effect dependency.
   */
  onHeightSettled?: () => void;
  /** Shown on the handle bar while collapsed, to say what tapping it opens. */
  collapsedLabel?: ReactNode;
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

export default function MobileBottomSheet({
  onHeightSettled,
  collapsedLabel,
  children,
}: MobileBottomSheetProps) {
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

  const collapsed = height === 0;
  // The scrim ramps across the last gap between snaps — it appears only once the sheet
  // is past "half" and on its way to covering the map.
  const topSnap = snaps[snaps.length - 1];
  const dimFromSnap = snaps.length >= 2 ? snaps[snaps.length - 2] : topSnap;
  const dimProgress =
    height === null || topSnap <= dimFromSnap
      ? 0
      : Math.min(Math.max((height - dimFromSnap) / (topSnap - dimFromSnap), 0), 1);
  const scrimOpacity = dimProgress * MAX_SCRIM_OPACITY;
  const scrimVisible = scrimOpacity > 0.02;

  return (
    <div
      ref={sheetRef}
      // z-20 so the seam belongs to the sheet: the map pane it overlaps is not a
      // stacking context, so anything positioned inside it (the search box at z-10,
      // its dropdown at z-20, MapLibre's own control stacks at z-2) otherwise painted
      // over the rounded top edge and the handle beside it.
      className="mobile-sheet relative z-20 flex-shrink-0 bg-white rounded-t-2xl flex flex-col sheet-slide-up"
      style={{
        marginTop: -SHEET_OVERLAP_PX,
        boxShadow: dragging
          ? "0 -6px 28px rgba(15, 23, 42, 0.22)"
          : "0 -2px 14px rgba(15, 23, 42, 0.14)",
        transition: "box-shadow 200ms ease-out",
      }}
    >
      {/* Always mounted, so it fades both ways: conditioned on the opacity it would
          pop out of existence the moment a collapsing sheet crossed the snap.
          `disabled` rather than `aria-hidden`, which would leave a focusable
          element hidden from a screen reader. */}
      <button
        type="button"
        aria-label="Shrink panel"
        disabled={!scrimVisible}
        onClick={() => setHeight(dimFromSnap)}
        className={`absolute inset-x-0 bottom-full h-dvh bg-slate-900 cursor-default ${
          scrimVisible ? "" : "pointer-events-none"
        }`}
        style={{ opacity: scrimOpacity, transition: dragging ? "none" : "opacity 250ms ease-out" }}
      />

      <button
        type="button"
        aria-label={collapsed ? "Open panel" : "Resize panel"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        className={`group w-full flex flex-col items-center justify-center gap-1.5 touch-none select-none cursor-grab active:cursor-grabbing flex-shrink-0 ${
          collapsed ? "min-h-11 py-2" : "py-2"
        }`}
      >
        <span
          className={`rounded-full transition-all duration-150 ${
            dragging
              ? "w-14 h-1 bg-gray-500"
              : "w-10 h-1 bg-gray-300 group-hover:bg-gray-400 group-active:bg-gray-500"
          }`}
        />
        {collapsed && collapsedLabel && (
          <span className="flex items-center gap-1 text-xs font-medium text-gray-600">
            {collapsedLabel}
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 15l7-7 7 7"
              />
            </svg>
          </span>
        )}
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
