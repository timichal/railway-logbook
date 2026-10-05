# UI / UX to-do

Found in a walkthrough of the main map (desktop, and a 390px-wide phone viewport) on
2026-09-29. The mobile bottom sheet rewrite from that session is done; everything
below is still open. Rough priority order within each section.

## My Trips (`JourneysAndTripsTab`, `JourneyCard`, `TripCard`)

- [ ] **Guard an unsaved edit against everything that closes the card.** A card being
  edited locks only its *own* header. Tapping the parent trip's header, another
  card's header (single-open closes the edited one), Prev/Next or a search that
  drops the card all close or unmount it, and the edit is thrown away without a
  word. The fix belongs in `JourneysAndTripsTab`, which owns the open state: have
  a card report that it is editing (journey or trip form), and refuse — or confirm —
  any open-state change, page change or search while it is.

## Mobile sheet follow-ups (`MobileBottomSheet.tsx`)

- [ ] **Tune on a real phone.** Flick feel was not testable in the session (the
  browser window was hidden, so timers were throttled). Knobs: `FLICK_PROJECTION_MS`,
  `SNAP_TRANSITION_MS`, `SNAP_EASING`.
- [ ] **Pull down from content scrolled to the top** to lower the sheet (the usual
  native sheet behaviour). Currently only the handle and tab bar drag.

## Desktop

- [ ] **Narrower default sidebar.** 600px default left ~315px of map in a 915px-wide
  viewport. Default to something like `clamp(360px, 40vw, 600px)`
  (`initialWidth` in `src/hooks/useResizableSidebar.ts`). The width is not persisted
  either, so a resize is lost on reload — worth storing in localStorage alongside.
