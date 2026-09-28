"use client";

import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * The mobile sheet that carries the sidebar, anchored to the **bottom** of the map —
 * where the thumb is, and growing upward so it does not cover the part of the map
 * that was just tapped.
 *
 * Four snap points: collapsed, a peek that shows the tab bar, half, and almost-full.
 * Drag the handle or the tab bar, tap the handle to toggle, or ArrowUp/ArrowDown on
 * it. A flick carries: the release point is projected along its velocity before the
 * nearest snap is picked, so a short fast swipe goes where it was thrown instead of
 * springing back.
 *
 * **It lies over the map and moves by `transform`, never by layout.** It used to be a
 * flex sibling that changed its height, and every frame of a drag then resized the
 * map: MapLibre watches its container and re-creates and redraws the canvas on every
 * size change, and a resize keeps the centre, so the map slid by half the drag in
 * 50ms steps. Now the map is always full height, and what the sheet covers reaches it
 * as camera padding (`onSettled`) instead — so centring, `flyTo` and `fitBounds` all
 * aim at the visible part without the map ever moving under the finger.
 *
 * **A drag renders nothing.** The position lives in a ref and is written straight to
 * the DOM (transform, scrim opacity, `--sheet-visible`); React hears about it only
 * when a gesture starts and ends. What does change at those two moments is the
 * content box's height: while moving it is the height of the topmost snap, so
 * whatever the drag uncovers is already laid out; at rest it is exactly the visible
 * height, so the scroll container ends where the screen does and its bottom can be
 * scrolled to. The transform makes up the difference, and is written in a layout
 * effect so the two never land in different frames.
 *
 * **`--sheet-visible`**, set on the parent on every frame, is how the map's bottom
 * furniture (attribution, scale, progress box) rides above the sheet — see
 * `globals.css` and `MapProgressBox`.
 *
 * **The handle stays visible at the collapsed snap** — it is the sheet's only control,
 * so a collapsed sheet must never be a state with no way back out of it. Collapsed, it
 * carries a caption (`collapsedLabel`) and a chevron: a bare grey bar on the map says
 * that something is there but not what.
 *
 * **The scrim is the drag's other piece of feedback.** Past the half snap the map
 * behind dims in proportion to how far the sheet has come, and tapping the dimmed part
 * drops back to half. It is drawn upward from the sheet's own top edge, so the root's
 * `overflow-hidden` clips it to the map and the navbar is never dimmed.
 */

/** Peek shows the tab bar and the first line of content. */
const PEEK_PX = 120;
/** Fractions of the available height for the two larger snaps. */
const HALF_FRACTION = 0.5;
const FULL_FRACTION = 0.9;
/** Movement past this many pixels is a drag, not a tap. */
const DRAG_THRESHOLD_PX = 6;
const SNAP_TRANSITION_MS = 280;
const SNAP_EASING = "cubic-bezier(0.2, 0.9, 0.3, 1)";
/**
 * How far along its release velocity a drag is projected before snapping, in ms of
 * travel at that speed. Large enough that a flick skips a snap, small enough that a
 * slow deliberate drag still lands where it was let go.
 */
const FLICK_PROJECTION_MS = 180;
/** Only the pointer samples this recent count towards the release velocity. */
const VELOCITY_WINDOW_MS = 100;
/** How dark the map behind goes at the topmost snap. */
const MAX_SCRIM_OPACITY = 0.4;
/** Marks the elements a drag can start from: the handle, and the tab bar inside. */
const DRAG_REGION_SELECTOR = "[data-sheet-drag]";

interface MobileBottomSheetProps {
  /**
   * Called when the sheet comes to rest, with how many pixels of the parent it now
   * covers — the map's bottom padding.
   */
  onSettled?: (visibleHeight: number) => void;
  /**
   * Called on every frame the sheet moves, with how much of the parent is left
   * uncovered above it — lets the map hide top furniture that no longer fits.
   */
  onMapRoomChange?: (room: number) => void;
  /** Shown on the handle bar while collapsed, to say what tapping it opens. */
  collapsedLabel?: ReactNode;
  children: ReactNode;
}

type Phase = "idle" | "dragging" | "animating";

function snapPointsFor(available: number): number[] {
  if (available <= 0) return [0, PEEK_PX];
  const peek = Math.min(PEEK_PX, available);
  const points = [0, peek, available * HALF_FRACTION, available * FULL_FRACTION];
  // A short viewport can collapse the larger snaps into one; keep them ascending
  // and distinct so the snap order never repeats a height.
  return [...new Set(points.map((p) => Math.round(Math.min(p, available))))].sort((a, b) => a - b);
}

function nearestSnap(height: number, snaps: number[]): number {
  return snaps.reduce((best, s) => (Math.abs(s - height) < Math.abs(best - height) ? s : best));
}

/** Where a tap on the handle goes: up to half from below it, down to peek from half. */
function tapTarget(current: number, snaps: number[], available: number): number {
  const half = nearestSnap(available * HALF_FRACTION, snaps);
  const peek = snaps.length > 1 ? snaps[1] : snaps[0];
  if (current < half) return half;
  if (current === half) return peek;
  return half;
}

export default function MobileBottomSheet({
  onSettled,
  onMapRoomChange,
  collapsedLabel,
  children,
}: MobileBottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLButtonElement>(null);
  const scrimRef = useRef<HTMLButtonElement>(null);

  const [available, setAvailable] = useState(0);
  /** Where the sheet is (or is headed, while animating). Null until measured. */
  const [settled, setSettled] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");

  /** The height currently on screen, written on every frame of a drag. */
  const heightRef = useRef(0);
  /** The content box height currently in the DOM (see the header comment). */
  const contentRef = useRef(0);
  const animationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const snaps = snapPointsFor(available);
  const topSnap = snaps[snaps.length - 1];
  const dimFromSnap = snaps.length >= 2 ? snaps[snaps.length - 2] : topSnap;
  const contentHeight = phase === "idle" ? (settled ?? 0) : topSnap;

  // Kept in refs so the window listeners and the layout effect read this render's
  // values without being re-created per render.
  const live = useRef({ available, snaps, topSnap, dimFromSnap, onMapRoomChange, onSettled });
  live.current = { available, snaps, topSnap, dimFromSnap, onMapRoomChange, onSettled };

  /** Puts the sheet at `height` on screen: transform, scrim, furniture offset. */
  const paint = useCallback((height: number) => {
    heightRef.current = height;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const { available, topSnap, dimFromSnap, onMapRoomChange } = live.current;
    const offset = contentRef.current - height;
    // No transform at all at rest: a transformed element is the containing block of
    // every `position: fixed` inside it.
    sheet.style.transform = Math.abs(offset) < 0.5 ? "" : `translateY(${offset}px)`;

    const scrim = scrimRef.current;
    if (scrim) {
      const progress =
        topSnap <= dimFromSnap
          ? 0
          : Math.min(Math.max((height - dimFromSnap) / (topSnap - dimFromSnap), 0), 1);
      scrim.style.opacity = String(progress * MAX_SCRIM_OPACITY);
    }

    const visible = height + (bandRef.current?.offsetHeight ?? 0);
    sheet.parentElement?.style.setProperty("--sheet-visible", `${visible}px`);
    onMapRoomChange?.(available - visible);
  }, []);

  const setTransition = useCallback((on: boolean) => {
    const transition = on ? `transform ${SNAP_TRANSITION_MS}ms ${SNAP_EASING}` : "none";
    if (sheetRef.current) sheetRef.current.style.transition = transition;
    if (scrimRef.current)
      scrimRef.current.style.transition = on
        ? `opacity ${SNAP_TRANSITION_MS}ms ${SNAP_EASING}`
        : "none";
  }, []);

  // The parent is the box the sheet lies over, so its height is the budget.
  useEffect(() => {
    const parent = sheetRef.current?.parentElement;
    if (!parent) return;
    const update = () => setAvailable(parent.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  // Open at half, and follow the budget when the viewport changes (rotation, the iOS
  // toolbar collapsing) rather than keeping a height that no longer fits.
  useEffect(() => {
    if (available <= 0) return;
    const points = snapPointsFor(available);
    setSettled((current) =>
      current === null
        ? nearestSnap(available * HALF_FRACTION, points)
        : Math.min(Math.max(current, points[0]), points[points.length - 1]),
    );
  }, [available]);

  // The content box just changed height: re-derive the transform from the same
  // on-screen height before the browser paints, so the sheet does not jump.
  useLayoutEffect(() => {
    contentRef.current = contentHeight;
    if (phase === "idle") {
      setTransition(false);
      paint(contentHeight);
    } else {
      paint(heightRef.current);
    }
  }, [contentHeight, phase, paint, setTransition]);

  // Report the resting height once the sheet stops.
  useEffect(() => {
    if (phase !== "idle" || settled === null) return;
    live.current.onSettled?.(settled + (bandRef.current?.offsetHeight ?? 0));
  }, [phase, settled]);

  useEffect(
    () => () => {
      if (animationTimer.current) clearTimeout(animationTimer.current);
    },
    [],
  );

  /** Animates from wherever the sheet is on screen to `target`. */
  const snapTo = useCallback(
    (target: number) => {
      if (animationTimer.current) clearTimeout(animationTimer.current);
      setSettled(target);
      setPhase("animating");
      // Started after the commit that grows the content box: the layout effect has
      // then painted the start position, and a forced reflow makes it the point the
      // transition runs from.
      requestAnimationFrame(() => {
        sheetRef.current?.getBoundingClientRect();
        setTransition(true);
        paint(target);
      });
      animationTimer.current = setTimeout(() => {
        animationTimer.current = null;
        setPhase("idle");
      }, SNAP_TRANSITION_MS + 30);
    },
    [paint, setTransition],
  );

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (settled === null || !e.isPrimary || e.button !== 0) return;
    if (!(e.target as Element).closest(DRAG_REGION_SELECTOR)) return;

    const startY = e.clientY;
    // Mid-snap, `heightRef` already holds the target; start from where the sheet
    // actually is on screen, or catching it would make it jump.
    const sheet = sheetRef.current;
    const startHeight =
      phase === "animating" && sheet
        ? contentRef.current - new DOMMatrix(getComputedStyle(sheet).transform).m42
        : heightRef.current;
    const pointerId = e.pointerId;
    const samples: { t: number; y: number }[] = [{ t: e.timeStamp, y: e.clientY }];
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const delta = startY - ev.clientY;
      if (!moved) {
        if (Math.abs(delta) <= DRAG_THRESHOLD_PX) return;
        moved = true;
        if (animationTimer.current) clearTimeout(animationTimer.current);
        setTransition(false);
        setPhase("dragging");
      }
      samples.push({ t: ev.timeStamp, y: ev.clientY });
      while (samples.length > 2 && ev.timeStamp - samples[0].t > VELOCITY_WINDOW_MS)
        samples.shift();
      const { snaps } = live.current;
      paint(Math.min(Math.max(startHeight + delta, snaps[0]), snaps[snaps.length - 1]));
    };

    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      if (!moved) return;

      // The drag ends in a click on whatever it started on — a tab, or the handle,
      // whose click is the tap toggle. Neither should run.
      const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);

      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = last.t - first.t;
      // Positive = upward, in px per ms.
      const velocity = dt > 0 ? (first.y - last.y) / dt : 0;
      const projected = heightRef.current + velocity * FLICK_PROJECTION_MS;
      snapTo(nearestSnap(projected, live.current.snaps));
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    if (settled === null) return;
    const index = snaps.indexOf(nearestSnap(settled, snaps));
    const next = e.key === "ArrowUp" ? index + 1 : index - 1;
    snapTo(snaps[Math.min(Math.max(next, 0), snaps.length - 1)]);
  };

  const collapsed = phase === "idle" && settled === 0;
  const scrimActive = phase === "idle" && settled !== null && settled > dimFromSnap;

  return (
    <div
      ref={sheetRef}
      onPointerDown={handlePointerDown}
      // z-20 so the sheet is above everything positioned in the map pane (the search
      // box at z-10, its dropdown at z-20 but earlier in the DOM, MapLibre's controls).
      className="mobile-sheet absolute inset-x-0 bottom-0 z-20 bg-surface rounded-t-2xl flex flex-col sheet-slide-up"
      style={{
        boxShadow:
          phase === "dragging"
            ? "0 -6px 28px rgba(15, 23, 42, 0.22)"
            : "0 -2px 14px rgba(15, 23, 42, 0.14)",
      }}
    >
      {/* Always mounted, so it fades both ways. `disabled` rather than `aria-hidden`,
          which would leave a focusable element hidden from a screen reader. */}
      <button
        ref={scrimRef}
        type="button"
        aria-label="Shrink panel"
        disabled={!scrimActive}
        onClick={() => snapTo(dimFromSnap)}
        className={`absolute inset-x-0 bottom-full h-dvh bg-slate-900 cursor-default ${
          scrimActive ? "" : "pointer-events-none"
        }`}
        style={{ opacity: 0 }}
      />

      <button
        ref={bandRef}
        type="button"
        data-sheet-drag=""
        aria-label={collapsed ? "Open panel" : "Resize panel"}
        onClick={() => settled !== null && snapTo(tapTarget(settled, snaps, available))}
        onKeyDown={handleKeyDown}
        className="group w-full h-10 flex flex-col items-center justify-center gap-1 touch-none select-none cursor-grab active:cursor-grabbing flex-shrink-0"
      >
        <span
          className={`rounded-full transition-all duration-150 ${
            phase === "dragging"
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
        className="min-h-0 overflow-hidden flex flex-col"
        style={{ height: settled === null ? `${HALF_FRACTION * 100}%` : `${contentHeight}px` }}
      >
        {children}
      </div>
    </div>
  );
}
