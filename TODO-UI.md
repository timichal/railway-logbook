# UI / UX to-do

Found in a walkthrough of the main map (desktop, and a 390px-wide phone viewport) on
2026-09-29. The mobile bottom sheet rewrite from that session is done; everything
below is still open. Rough priority order within each section.

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
