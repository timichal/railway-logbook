# UI / UX to-do

Found in a walkthrough of the main map (desktop, and a 390px-wide phone viewport) on
2026-09-29. The mobile bottom sheet rewrite from that session is done; everything
below is still open. Rough priority order within each section.

## My Trips (`JourneysAndTripsTab`, `JourneyCard`, `TripCard`)

- [ ] **Open read-only first.** "View / Edit" drops straight into edit mode (Save /
  Cancel, and map taps now add/remove routes). Open to a view — routes, stats, the map
  highlight — with an explicit Edit button that enters the current edit mode.
- [ ] **Make the row the tap target and drop the per-row Delete.** Every row carries a
  blue View / Edit and a red Delete; the red repeats down the list and the buttons
  truncate names ("Malá Moráv…", "Trhov…"). Tap the row to open; move Delete into the
  opened card (it already has a confirm step).
- [ ] **Lower the sheet when map picking starts.** Editing a journey says "click routes
  on the map", but at the sheet's 90% snap the map is a ~40px strip. On entering edit
  mode on mobile, snap the sheet to half — `useBottomSheet()?.snapTo("half")` from
  `MobileBottomSheet` (null on desktop, so the call is safe in shared components).

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
