import { type RefObject, useCallback, useEffect, useRef } from "react";

/** The nearest ancestor of `element` that scrolls vertically, or null. */
function scrollContainerOf(element: HTMLElement): HTMLElement | null {
  let scroller = element.parentElement;
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
    scroller = scroller.parentElement;
  }
  return scroller;
}

/**
 * Scrolls `element`'s own scroll container so the element's top sits `margin`
 * px below the container's. Never `scrollIntoView`: in the mobile bottom sheet,
 * which moves by transform, the browser would make up any difference by
 * scrolling the overflow-hidden ancestors (the map root and the map pane), which
 * then jump back when the transform comes off. Both rects sit under the same
 * transform, so their difference is the element's offset in the container
 * whatever the sheet is doing.
 *
 * `onlyIfLow` leaves the container alone when the element's top is already in
 * its upper half, where the element (and what it grows into below) is in view
 * without moving what is above it.
 */
export function scrollInContainer(
  element: HTMLElement,
  {
    margin = 8,
    behavior = "smooth",
    onlyIfLow = false,
  }: {
    margin?: number;
    behavior?: ScrollBehavior;
    onlyIfLow?: boolean;
  } = {},
): void {
  const scroller = scrollContainerOf(element);
  if (!scroller) return;
  const box = scroller.getBoundingClientRect();
  const offset = element.getBoundingClientRect().top - box.top;
  if (onlyIfLow && offset >= 0 && offset <= box.height / 2) return;
  scroller.scrollTo({ top: scroller.scrollTop + offset - margin, behavior });
}

/** How long a revealed card is followed as it grows (see useRevealJourneyCard). */
const REVEAL_FOLLOW_MS = 3000;
/** Anything the user does that means they have taken the scrolling over. */
const USER_TAKEOVER_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * Brings the card of `journeyId` (as it is on mount) into view once `ready`:
 * the journey My Trips or My Journeys reopens on after an edit, which may sit far
 * down the list. The card is found by `data-journey-id` under `rootRef`.
 *
 * The list being ready is not enough. The card opens with nothing in it yet and
 * loads its routes afterwards, and until it grows a list that fits the pane has
 * nowhere to scroll to. So the card is followed as it resizes, for a few seconds.
 * Once its top is in the upper half, a resize leaves it be.
 *
 * Asked once, and given up for good when:
 * - the user scrolls, touches or types, from mount on, so a list they started
 *   on while it loaded is never pulled away from them;
 * - the list is ready without the card (deleted, or another region's);
 * - `regionId` changes from the one at mount, since a region switch clears
 *   what was picked in the old one;
 * - the following runs its course.
 * Only those let the id go, not an effect running, because StrictMode runs
 * every effect twice.
 */
export function useRevealJourneyCard(
  rootRef: RefObject<HTMLElement | null>,
  journeyId: number | string | null,
  ready: boolean,
  regionId: string,
): void {
  const pendingRef = useRef(journeyId);
  const mountRegionRef = useRef(regionId);
  // Undo the following under way, and the takeover listeners, while they are set
  const stopFollowingRef = useRef<(() => void) | null>(null);
  const detachRef = useRef<(() => void) | null>(null);

  const giveUp = useCallback(() => {
    pendingRef.current = null;
    stopFollowingRef.current?.();
    detachRef.current?.();
  }, []);

  useEffect(() => {
    if (pendingRef.current === null) return;
    for (const type of USER_TAKEOVER_EVENTS) {
      window.addEventListener(type, giveUp, { capture: true, passive: true });
    }
    const detach = () => {
      for (const type of USER_TAKEOVER_EVENTS) {
        window.removeEventListener(type, giveUp, { capture: true });
      }
      detachRef.current = null;
    };
    detachRef.current = detach;
    return detach;
  }, [giveUp]);

  useEffect(() => {
    if (regionId !== mountRegionRef.current) {
      giveUp();
      return;
    }
    const id = pendingRef.current;
    if (!ready || id === null) return;
    const card = rootRef.current?.querySelector<HTMLElement>(
      `[data-journey-id="${CSS.escape(String(id))}"]`,
    );
    if (!card) {
      giveUp();
      return;
    }
    // Landed on rather than travelled to: the list was never seen above it.
    // The observer also fires once as it starts, which is the first reveal.
    const observer = new ResizeObserver(() =>
      scrollInContainer(card, { behavior: "instant", onlyIfLow: true }),
    );
    observer.observe(card);
    const timer = setTimeout(giveUp, REVEAL_FOLLOW_MS);
    const stop = () => {
      observer.disconnect();
      clearTimeout(timer);
      stopFollowingRef.current = null;
    };
    stopFollowingRef.current = stop;
    return stop;
  }, [ready, regionId, rootRef, giveUp]);
}
