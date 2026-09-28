# UI / UX to-do

Found in a walkthrough of the main map (desktop, and a 390px-wide phone viewport) on
2026-09-29. The mobile bottom sheet rewrite from that session is done; everything
below is still open. Rough priority order within each section.

## Map

- [ ] **Zoom to what was just opened.** The user map never calls `fitBounds`
  (only `AdminMap` does), so opening a journey, a trip or a planner result lights up
  routes that may be off screen — opening "Jemnice" (Czechia) with the map on Aachen
  showed nothing at all.
  - Fit the highlighted routes' bounds when a journey/trip card opens
    (`JourneyCard`, `TripCard`, local equivalents in `LocalJourneyLogTab`) and when
    the planner returns a result (`JourneyPlanner` → `onHighlightRoutes`).
  - The bounds need geometry the highlight path may not have client-side (tile-filter
    overlays carry only ids); likely a small server query returning the bbox of a set
    of track ids, or bounds computed where `PartialRouteGeometry` already exists.
  - Mobile: the camera already carries the sheet as bottom padding
    (`handleSheetSettled` in `RailwayMap`), so a plain `fitBounds` lands in the
    visible part. Add some padding of its own on top of that; cap `maxZoom`.
  - Don't refit on every re-highlight of the same set (e.g. a route added in edit
    mode) — only when the opened item changes.

## Route Logger (`RouteLogger.tsx`)

- [ ] **Reorder the tab to follow the task.** Routes are picked first, the journey is
  named last, but the tab opens on Name / Date / Description / Trip, then the planner,
  then Selected Routes, then the button. At the sheet's half snap on a phone only the
  empty form is visible. Proposed order: Journey Planner → Selected Routes → journey
  fields → submit.
- [ ] **Make the peek snap a summary bar.** At 120px it shows the tabs and a heading.
  Show "3 routes · 84 km  [Log journey]" instead (tapping Log opens the sheet to the
  form). Needs `MobileBottomSheet` to accept a peek slot, or the logger to render a
  compact header the sheet shows at peek.
- [ ] **Feedback when a route is added with the sheet open.** The selection count is
  only in the collapsed sheet's caption. Put it in the tab label ("Logger · 3",
  `UserSidebar`), and/or briefly pulse the count.
- [ ] **Suggest a journey name.** Pre-fill (or offer as a one-tap suggestion) from the
  first and last station of the selection, or the planner's from/to. The name is the
  one field a user is forced to type.
- [ ] **Say why the submit button is disabled.** The reason (`missingField` /
  `blockedReason`) is only in a `title` tooltip, which touch never shows. Render it as
  a line of hint text under the button.
- [ ] **Pluralise the button** — "Create Journey & Log 1 Routes".
- [ ] **Two "Clear all" links a screen apart** (planner and selection) — rename to
  "Clear planner" / "Clear selection", or fold the planner's into its own form.
- [ ] **Total distance counts partial routes whole.** `SelectedRoutesList` sums
  `length_km`; a planner-partial route carries `covered` with its fractions, so use
  the travelled length there (and show it per row, as the planner result does).

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
  mode on mobile, snap the sheet to half — needs a way for content to ask the sheet
  for a snap (e.g. a context exposing `snapTo("half")` from `MobileBottomSheet`).

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
