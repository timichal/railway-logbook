"use client";

import {
  createContext,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Icon from "@/components/ui/Icon";

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
 * **The content drags it too, downward from its top**, as a native sheet does: a
 * finger pulling down on content with nothing above it to scroll back to moves the
 * sheet instead. This one runs on touch events, not pointer events: the content keeps
 * its `touch-action` for scrolling, so the browser claims any vertical pan there and
 * cancels the pointer — only a non-passive `touchmove` can take the gesture back, by
 * cancelling it before scrolling begins. While the gesture is undecided its downward
 * moves are cancelled: at the top there is nothing for them to scroll, only the
 * overscroll bounce or pull-to-refresh they would start. A finger that moves up or
 * sideways first is left to scroll for the whole touch.
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
 * the DOM (transform, scrim opacity); React hears about it only when a gesture starts
 * and ends. What does change at those two moments is the content box's height: while
 * moving it is the height of the topmost snap, so whatever the drag uncovers is
 * already laid out; at rest it is exactly the visible height, so the scroll container
 * ends where the screen does and its bottom can be scrolled to. The transform makes
 * up the difference, and is written in a layout effect so the two never land in
 * different frames.
 *
 * **What it covers is reported on every frame it moves** (`onCoverChange`) — while a
 * snap animates too, read back off the running transition, since reporting the target
 * at once had the map's furniture arrive before the sheet did. That is how the
 * attribution, scale and progress box ride above it (`--sheet-visible`, which
 * `RailwayMap` sets on the map pane).
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
 *
 * **At the peek snap it can show a summary instead** (`peekContent`): 120px is room
 * for the tab bar and a heading, which says nothing, or for one line that does. The
 * children stay mounted underneath (inert), so nothing in them is lost, and a drag
 * from the summary uncovers them as soon as it moves.
 *
 * **Content can move the sheet** through `useBottomSheet()`, which is null outside
 * one — so a component shared with the desktop sidebar asks, and does nothing there.
 */

/** Peek shows the tab bar and the first line of content. */
const PEEK_PX = 120;
/**
 * The handle band, `h-11` below: the collapsed sheet's only control, so it keeps the
 * 44px touch floor. A constant, so a drag frame never has to measure it.
 */
const BAND_PX = 44;
/** Fractions of the content budget (the parent less the band) for the two larger snaps. */
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
/**
 * Only the pointer samples this recent count towards the release velocity, and a
 * pointer held still this long before letting go was placed, not thrown.
 */
const VELOCITY_WINDOW_MS = 100;
/**
 * How long after a drag its trailing click is swallowed, unless another press comes
 * first: a touch's click can arrive a task or two after its pointerup.
 */
const CLICK_SWALLOW_MS = 400;
/** How dark the map behind goes at the topmost snap. */
const MAX_SCRIM_OPACITY = 0.4;
/** Marks the elements a drag can start from: the handle, and the tab bar inside. */
const DRAG_REGION_SELECTOR = "[data-sheet-drag]";
/** Content whose own touch drags (caret, selection, a slider) a pull must not take. */
const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** A drag of the sheet under way, fed by pointer or touch events alike. */
interface DragGesture {
  move: (y: number, t: number) => void;
  end: (t: number) => void;
}

interface MobileBottomSheetProps {
  /**
   * Called when the sheet comes to rest, with how many pixels of the parent it now
   * covers — the map's bottom padding.
   */
  onSettled?: (covered: number) => void;
  /**
   * Called on every frame the sheet moves (dragged or snapping), with how many pixels
   * of the parent it covers and how many it leaves uncovered above it.
   */
  onCoverChange?: (covered: number, room: number) => void;
  /** Shown on the handle bar while collapsed, to say what tapping it opens. */
  collapsedLabel?: ReactNode;
  /** Shown in place of the children while the sheet rests at the peek snap. */
  peekContent?: ReactNode;
  children: ReactNode;
}

type Phase = "idle" | "dragging" | "animating";

/** The snap points by name, for content asking the sheet to move. */
type SheetSnap = "collapsed" | "peek" | "half" | "full";

interface BottomSheetControls {
  snapTo: (snap: SheetSnap) => void;
}

const BottomSheetContext = createContext<BottomSheetControls | null>(null);

/** The sheet this component is rendered in, or null outside one (the desktop sidebar). */
export function useBottomSheet(): BottomSheetControls | null {
  return useContext(BottomSheetContext);
}

/**
 * Content heights to snap to. `budget` is the parent less the band, so the topmost
 * snap plus the band still fits — sized off the whole parent, a landscape phone's
 * short map pushed the handle out past the top edge, where it was clipped.
 */
function snapPointsFor(budget: number): number[] {
  if (budget <= 0) return [0];
  const peek = Math.min(PEEK_PX, budget);
  const points = [0, peek, budget * HALF_FRACTION, budget * FULL_FRACTION];
  // A short viewport can collapse the larger snaps into one; keep them ascending
  // and distinct so the snap order never repeats a height.
  return [...new Set(points.map((p) => Math.round(Math.min(p, budget))))].sort((a, b) => a - b);
}

function nearestSnap(height: number, snaps: number[]): number {
  return snaps.reduce((best, s) => (Math.abs(s - height) < Math.abs(best - height) ? s : best));
}

/** The half snap, or whichever snap stands in for it on a viewport too short to have one. */
function halfSnap(snaps: number[], budget: number): number {
  return nearestSnap(budget * HALF_FRACTION, snaps);
}

/** The peek snap, or the collapsed one where there is no other. */
function peekSnap(snaps: number[]): number {
  return snaps.length > 1 ? snaps[1] : snaps[0];
}

/** Where a tap on the handle goes: up to half from below it, down to peek from half. */
function tapTarget(current: number, snaps: number[], budget: number): number {
  const half = halfSnap(snaps, budget);
  const peek = peekSnap(snaps);
  if (current < half) return half;
  if (current === half) return peek;
  return half;
}

/** The content height a sheet shows on screen, read off its current transform. */
function onScreenHeight(sheet: HTMLElement, contentHeight: number): number {
  return contentHeight - new DOMMatrix(getComputedStyle(sheet).transform).m42;
}

/**
 * Whether anything from `target` up to (not including) `root` is scrolled off its top.
 * A pixel's grace: a fling can come to rest at a fractional offset that looks like 0.
 */
function scrolledFromTop(target: Element, root: Element): boolean {
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    if (el.scrollTop >= 1) return true;
  }
  return false;
}

/**
 * Swallows the click a drag ends in — on a tab, or on the handle, whose click is the
 * tap toggle; neither should run. That click may come a task or two later, so the
 * swallow stands until it arrives, the next press, or a timeout — whichever is first.
 */
function swallowTrailingClick() {
  const release = () => {
    clearTimeout(timer);
    window.removeEventListener("click", swallow, { capture: true });
    window.removeEventListener("pointerdown", release, { capture: true });
  };
  const swallow = (click: MouseEvent) => {
    click.stopPropagation();
    click.preventDefault();
    release();
  };
  const timer = setTimeout(release, CLICK_SWALLOW_MS);
  window.addEventListener("click", swallow, { capture: true });
  window.addEventListener("pointerdown", release, { capture: true });
}

export default function MobileBottomSheet({
  onSettled,
  onCoverChange,
  collapsedLabel,
  peekContent,
  children,
}: MobileBottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLButtonElement>(null);
  /** The content box: where a pull down can start. */
  const bodyRef = useRef<HTMLDivElement>(null);

  const [available, setAvailable] = useState(0);
  /** Where the sheet is (or is headed, while animating). Null until measured. */
  const [settled, setSettled] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");

  /** The height currently on screen (or a snap's target), written on every drag frame. */
  const heightRef = useRef(0);
  /** The content box height currently in the DOM (see the header comment). */
  const contentRef = useRef(0);
  const animationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The rAF that starts a snap, then follows it for `onCoverChange`. */
  const animationFrame = useRef<number | null>(null);

  const budget = Math.max(available - BAND_PX, 0);
  const snaps = snapPointsFor(budget);
  const topSnap = snaps[snaps.length - 1];
  const dimFromSnap = snaps.length >= 2 ? snaps[snaps.length - 2] : topSnap;
  const contentHeight = phase === "idle" ? (settled ?? 0) : topSnap;

  // Kept in refs so the window listeners and the layout effect read this render's
  // values without being re-created per render.
  const live = useRef({
    available,
    budget,
    snaps,
    topSnap,
    dimFromSnap,
    onCoverChange,
    onSettled,
  });
  live.current = { available, budget, snaps, topSnap, dimFromSnap, onCoverChange, onSettled };

  const reportCover = useCallback((height: number) => {
    const { available, onCoverChange } = live.current;
    onCoverChange?.(height + BAND_PX, available - height - BAND_PX);
  }, []);

  /**
   * Puts the sheet at `height`: transform and scrim, and the cover report — unless a
   * snap is about to animate there, when the cover is followed frame by frame.
   */
  const paint = useCallback(
    (height: number, report = true) => {
      heightRef.current = height;
      const sheet = sheetRef.current;
      if (!sheet) return;
      const { topSnap, dimFromSnap } = live.current;
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

      if (report) reportCover(height);
    },
    [reportCover],
  );

  const setTransition = useCallback((on: boolean) => {
    const transition = on ? `transform ${SNAP_TRANSITION_MS}ms ${SNAP_EASING}` : "none";
    if (sheetRef.current) sheetRef.current.style.transition = transition;
    if (scrimRef.current)
      scrimRef.current.style.transition = on
        ? `opacity ${SNAP_TRANSITION_MS}ms ${SNAP_EASING}`
        : "none";
  }, []);

  /** Cancels a snap in flight: its end timer, and its start/follow frame. */
  const stopAnimation = useCallback(() => {
    if (animationTimer.current) clearTimeout(animationTimer.current);
    animationTimer.current = null;
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = null;
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
    const budget = Math.max(available - BAND_PX, 0);
    const points = snapPointsFor(budget);
    setSettled((current) =>
      current === null
        ? halfSnap(points, budget)
        : Math.min(Math.max(current, points[0]), points[points.length - 1]),
    );
  }, [available]);

  // The content box just changed height: re-derive the transform from the same
  // on-screen height before the browser paints, so the sheet does not jump. Also
  // re-run when only the parent changed size (a rotation that leaves the snap where
  // it was), since how much of the map is left uncovered changed with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: available is an intentional trigger — paint reads it through `live`.
  useLayoutEffect(() => {
    contentRef.current = contentHeight;
    if (phase === "idle") {
      stopAnimation();
      setTransition(false);
      paint(contentHeight);
    } else {
      // Mid-snap the cover is already being followed off the transition.
      paint(heightRef.current, phase === "dragging");
    }
  }, [contentHeight, phase, available, paint, setTransition, stopAnimation]);

  // Report the resting height once the sheet stops.
  useEffect(() => {
    if (phase !== "idle" || settled === null) return;
    live.current.onSettled?.(settled + BAND_PX);
  }, [phase, settled]);

  useEffect(() => stopAnimation, [stopAnimation]);

  /** Animates from wherever the sheet is on screen to `target`. */
  const snapTo = useCallback(
    (target: number) => {
      stopAnimation();
      setSettled(target);
      setPhase("animating");
      // Started after the commit that grows the content box: the layout effect has
      // then painted the start position, and a forced reflow makes it the point the
      // transition runs from. The cover then follows the sheet frame by frame.
      animationFrame.current = requestAnimationFrame(() => {
        const sheet = sheetRef.current;
        if (!sheet) return;
        sheet.getBoundingClientRect();
        setTransition(true);
        paint(target, false);
        const follow = () => {
          reportCover(onScreenHeight(sheet, contentRef.current));
          animationFrame.current = requestAnimationFrame(follow);
        };
        follow();
      });
      animationTimer.current = setTimeout(() => {
        animationTimer.current = null;
        setPhase("idle");
      }, SNAP_TRANSITION_MS + 30);
    },
    [paint, setTransition, stopAnimation, reportCover],
  );

  const controls = useMemo<BottomSheetControls>(
    () => ({
      snapTo: (snap) => {
        const { snaps, budget } = live.current;
        const height =
          snap === "collapsed"
            ? snaps[0]
            : snap === "peek"
              ? peekSnap(snaps)
              : snap === "half"
                ? halfSnap(snaps, budget)
                : snaps[snaps.length - 1];
        snapTo(height);
      },
    }),
    [snapTo],
  );

  /**
   * Starts a drag once a press has moved far enough to be one, with the finger now at
   * `y`. The sheet moves on from wherever it is at this moment — mid-snap too, where
   * `heightRef` already holds the target and the press may be frames old — so it never
   * jumps; the press only seeds the velocity.
   */
  const beginDrag = useCallback(
    (press: { y: number; t: number }, y: number): DragGesture => {
      const sheet = sheetRef.current;
      const startHeight =
        animationTimer.current !== null && sheet
          ? onScreenHeight(sheet, contentRef.current)
          : heightRef.current;
      stopAnimation();
      setTransition(false);
      setPhase("dragging");
      const startY = y;
      const samples: { t: number; y: number }[] = [press];
      return {
        move: (y, t) => {
          samples.push({ t, y });
          while (samples.length > 2 && t - samples[0].t > VELOCITY_WINDOW_MS) samples.shift();
          const { snaps } = live.current;
          paint(Math.min(Math.max(startHeight + startY - y, snaps[0]), snaps[snaps.length - 1]));
        },
        end: (t) => {
          swallowTrailingClick();
          const first = samples[0];
          const last = samples[samples.length - 1];
          const dt = last.t - first.t;
          // Positive = upward, in px per ms. A finger that stopped before letting go
          // says nothing with its last moves about the release.
          const stale = t - last.t > VELOCITY_WINDOW_MS;
          const velocity = dt > 0 && !stale ? (first.y - last.y) / dt : 0;
          const projected = heightRef.current + velocity * FLICK_PROJECTION_MS;
          snapTo(nearestSnap(projected, live.current.snaps));
        },
      };
    },
    [paint, setTransition, stopAnimation, snapTo],
  );

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (settled === null || !e.isPrimary || e.button !== 0) return;
    if (!(e.target as Element).closest(DRAG_REGION_SELECTOR)) return;

    const press = { y: e.clientY, t: e.timeStamp };
    const pointerId = e.pointerId;
    let drag: DragGesture | null = null;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!drag) {
        if (Math.abs(press.y - ev.clientY) <= DRAG_THRESHOLD_PX) return;
        drag = beginDrag(press, ev.clientY);
      }
      drag.move(ev.clientY, ev.timeStamp);
    };

    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      drag?.end(ev.timeStamp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };

  /** The content touch being followed as a possible pull down, if any. */
  const pull = useRef<{ dragging: boolean; stop: () => void } | null>(null);

  /**
   * A touch on the content, which may become a pull down (see the header comment):
   * undecided until it has moved past the drag threshold, then the sheet's drag — or
   * dropped, leaving the rest of the touch to the content.
   *
   * Its moves are heard on the element touched, not the content box: a touch's events
   * go to where it started even once that element has left the DOM (a list reloaded
   * under the finger), and from there they no longer bubble.
   */
  const onContentTouchStart = useEffectEvent((e: TouchEvent) => {
    // Another finger landing leaves a drag to the first, and ends an undecided one.
    if (pull.current?.dragging) return;
    pull.current?.stop();
    const body = bodyRef.current;
    // Typed for its touch listeners; an SVG target has the same ones.
    const target = e.target as HTMLElement;
    if (settled === null || e.touches.length !== 1 || !body) return;
    // A text field's own drags (caret, selection) are left to it.
    if (target.closest(`${DRAG_REGION_SELECTOR}, ${EDITABLE_SELECTOR}`)) return;
    if (scrolledFromTop(target, body)) return;

    const { identifier, clientX: startX, clientY: startY } = e.touches[0];
    const press = { y: startY, t: e.timeStamp };
    let drag: DragGesture | null = null;
    const own = (ev: TouchEvent) => [...ev.changedTouches].find((t) => t.identifier === identifier);

    const onMove = (ev: TouchEvent) => {
      const touch = own(ev);
      if (!touch) return;
      if (!drag) {
        const dy = touch.clientY - startY;
        const dx = Math.abs(touch.clientX - startX);
        // Up is the content's, and so is a move the browser has already begun
        // scrolling with: it can no longer be cancelled.
        if (dy < 0 || !ev.cancelable) return state.stop();
        // Flat or sideways so far is not cancelled — a touch whose first move is
        // cancelled may never scroll — and past the threshold it is the content's.
        if (dy <= dx) {
          if (dx > DRAG_THRESHOLD_PX) state.stop();
          return;
        }
        ev.preventDefault();
        if (dy <= DRAG_THRESHOLD_PX) return;
        drag = beginDrag(press, touch.clientY);
        state.dragging = true;
      }
      if (ev.cancelable) ev.preventDefault();
      drag.move(touch.clientY, ev.timeStamp);
    };

    const onEnd = (ev: TouchEvent) => {
      if (!own(ev)) return;
      state.stop();
      drag?.end(ev.timeStamp);
    };

    const state = {
      dragging: false,
      stop: () => {
        target.removeEventListener("touchmove", onMove);
        target.removeEventListener("touchend", onEnd);
        target.removeEventListener("touchcancel", onEnd);
        if (pull.current === state) pull.current = null;
      },
    };
    pull.current = state;
    target.addEventListener("touchmove", onMove, { passive: false });
    target.addEventListener("touchend", onEnd);
    target.addEventListener("touchcancel", onEnd);
  });

  // A native listener, so the moves it adds can be non-passive (React's are passive).
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const start = (e: TouchEvent) => onContentTouchStart(e);
    body.addEventListener("touchstart", start, { passive: true });
    return () => {
      body.removeEventListener("touchstart", start);
      pull.current?.stop();
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    if (settled === null) return;
    const index = snaps.indexOf(nearestSnap(settled, snaps));
    const next = e.key === "ArrowUp" ? index + 1 : index - 1;
    snapTo(snaps[Math.min(Math.max(next, 0), snaps.length - 1)]);
  };

  const collapsed = phase === "idle" && settled === 0;
  const showPeek =
    peekContent != null && phase === "idle" && snaps.length > 1 && settled === snaps[1];
  const scrimActive = phase === "idle" && settled !== null && settled > dimFromSnap;

  return (
    <div
      ref={sheetRef}
      onPointerDown={handlePointerDown}
      // z-40: above everything positioned in the map pane — the search box (z-10) and
      // its dropdown (z-20), MapLibre's controls, and its popups (30, globals.css),
      // which would otherwise float over the sheet now that the pane runs beneath it.
      // Under the toasts (50).
      className="mobile-sheet absolute inset-x-0 bottom-0 z-40 bg-surface rounded-t-2xl flex flex-col sheet-slide-up"
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
        type="button"
        data-sheet-drag=""
        aria-label={collapsed ? "Open panel" : "Resize panel"}
        onClick={() => settled !== null && snapTo(tapTarget(settled, snaps, budget))}
        onKeyDown={handleKeyDown}
        className="group w-full h-11 flex flex-col items-center justify-center gap-1 touch-none select-none cursor-grab active:cursor-grabbing flex-shrink-0"
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
            <Icon name="chevronUp" className="w-3.5 h-3.5" />
          </span>
        )}
      </button>
      <div
        ref={bodyRef}
        className="relative min-h-0 overflow-hidden flex flex-col"
        style={{ height: settled === null ? `${HALF_FRACTION * 100}%` : `${contentHeight}px` }}
      >
        <BottomSheetContext.Provider value={controls}>
          <div inert={showPeek} className="flex-1 min-h-0 flex flex-col">
            {children}
          </div>
          {/* A drag region like the tab bar it covers, so the sheet is raised from here
              too; a tap on a control inside is still a click. */}
          {showPeek && (
            <div data-sheet-drag="" className="absolute inset-0 bg-surface touch-none select-none">
              {peekContent}
            </div>
          )}
        </BottomSheetContext.Provider>
      </div>
    </div>
  );
}
