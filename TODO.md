# Size audit — to-do

Found in an audit of the web app on 2026-10-11, looking for code that could be smaller
without becoming harder to read: dead code, duplication, and verbosity. It covers
`src/`, `database/`, the scripts and the docs. `mobile/` was **not** audited.

Line counts are rough estimates of the net saving.

Some things were left out on purpose. The long *why* comments are this codebase's
style, and most of them guard against a real regression, so they are not listed as
bloat. Neither is the HTTP API layer (`src/app/api/v1`), which is already tight.

---

## Medium

- [ ] **`LocalJourneyLogTab` vs `JourneyCard`** (~80 lines).
  `buildRouteMetaFromSelected` and `buildRouteFromSelected` are the same function;
  move it to `selectedRoutes.ts`. More broadly, the local tab still uses the old
  card layout ("View / Edit" button, inline Delete) and its own copy of the edit
  form, instead of `CardHeader` and the view/edit split. Converging them would remove
  most of its markup and make the two lists look alike. It also has the most
  `if (onX) { onX(); }` code and "// Trigger map refresh" comments in the codebase.

- [ ] **`JourneyCard` / `TripCard` action rows** (~40 lines). The delete-confirm row
  (`Delete this …?` + Delete + Cancel with focus refs) and the Edit/Delete row are
  copied between the two cards, along with `handleAskDelete` / `handleCancelDelete`.
  Extract a `CardActions` component.

- [ ] **Login/Register migration block** (~20 lines). "Migrate local journeys →
  `clearAll()` → toast, or a fallback toast on failure" is written twice. Make it one
  helper next to `describeJourneyMigration`.

- [ ] **`RouteMetadataFields` + `AdminScenicTab` text fields** (~50 lines). The
  label + input + junction-shortcut block appears 4 times in RouteMetadataFields
  (name/from/to/link) and 4 more in the scenic tab (two From/To pairs). Use a small
  `TextField` component.

- [ ] **One "features under this point" helper for both maps** (~15 lines, from the
  review of the interaction-modules refactor). "Keep the layers that exist, then
  `queryRenderedFeatures`" is still written three ways: the admin map's `hits()`, the
  user map's `routeFeatureAt()`, and the inline `public_notes`/`stations` checks in
  the user map's `handleRouteClick` and `handleDblClick`. The route hit layers
  (`railway_routes_click`, `railway_routes`) are also listed in both modules. Put one
  `featuresAt(map, point, layers)` and the shared list beside them in `src/lib/map/`.
  Route layer ids are spelled out in more places still: `ROUTE_LINE_LAYERS` (now
  exported from `useAdminLayerVisibility.ts`, used by `AdminMap`'s paint), the
  literal `railway_routes_click` there, and `useLayerFilters.ts`. Move
  `ROUTE_LINE_LAYERS` and the click layer id into that shared module (or
  `shared/map/layers.ts`, where the factories define them) and import them
  everywhere.

- [ ] **Smaller duplicates across layout files** (~30 lines).
  - The `dynamic(…, { loading: "Loading map..." })` placeholder is written 3 times
    (MainLayout, PublicMapLayout, AdminPageClient).
  - The desktop sidebar resizer `<div>` is copied in RailwayMap and AdminPageClient.
  - `JourneyLogger` and `LocalTripLogger` receive the same 7 props in `UserSidebar`.

- [ ] **Geometry shipped only to fly to it.** `AdminRouteDetail.geometry`, and the
  geometry of every scenic line in the list, are full LineStrings sent so the admin
  map can `JSON.parse` them and compute a bbox (`AdminMap` focus effect). Return a
  bbox from SQL (as `routeBoundsByIds` does) and pass it to the existing fit.

- [ ] **`tripQueries.ts` types.** `StandaloneJourneyWithStats` and `JourneyInTrip`
  are the same type.

---

## Comment noise (do it alongside the edits above, not as its own pass)

- [ ] Delete comments that repeat the next line: "// Handle save route functionality",
  "// Trigger map refresh", "// Calculate totals", "// Remove hover from previous
  part", "// Cleanup function", and so on. They are concentrated in
  `LocalJourneyLogTab`, `adminMapInteractions`, `AdminRoutesTab`,
  `AdminCreateRouteTab` and `dataAccess`.
- [ ] Replace `if (onX) { onX(); }` with `onX?.()`, and `onX || (() => {})` with an
  optional prop. Same files.
