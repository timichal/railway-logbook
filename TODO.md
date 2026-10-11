# Size audit — to-do

Found in an audit of the web app on 2026-10-11, looking for code that could be smaller
without becoming harder to read: dead code, duplication, and verbosity. It covers
`src/`, `database/`, the scripts and the docs. `mobile/` was **not** audited.

Line counts are rough estimates of the net saving. Items marked **verify** depend on
something only the server or the mobile plan can confirm, so check that before cutting.

Some things were left out on purpose. The long *why* comments are this codebase's
style, and most of them guard against a real regression, so they are not listed as
bloat. Neither is the HTTP API layer (`src/app/api/v1`), which is already tight.

---

## Larger refactors (the biggest wins)

- [ ] **Let the ownership FKs do the ownership checks** (~30 lines, one round trip
  per write). The composite FKs `(trip_id, user_id)` and `(journey_id, user_id)`
  already refuse a trip or journey that isn't the caller's, and `asMissingRow` now
  turns that refusal into the same 404 "Trip/Journey not found" the pre-checks give.
  So these are redundant:
  - `assertOwnTrip` (`SELECT … FOR KEY SHARE`) in `createJourneyForUser` and
    `saveJourneyEditsForUser`;
  - the trip `SELECT` in `assignJourneyToTripForUser` (its UPDATE already maps the
    FK violation);
  - the journey `SELECT` in `addRoutesToJourneyForUser`. It is still needed when
    `trackIds` is empty, since then no row is inserted and nothing checks the FK.

  The pre-checks were written on purpose (see `assertOwnTrip`'s comment), so before
  dropping them, confirm the server's FKs exist with the expected tables. The
  constraint names don't matter, because `asMissingRow` keys on the table name.

- [ ] **Run the independent trip reads in parallel** (latency, not lines).
  `tripForUser` runs its journeys and route-id queries one after the other;
  `journeysAndTripsForUser` does the same with count + page, then with its three
  hydration queries. Use `Promise.all` on each independent group. That takes a
  trip open from 3 serial round trips to 2, and a logbook page from 5 to 3.

- [ ] **Admin route filters as a table** (~80 lines). `AdminRoutesTab` keeps four
  filter booleans and four counts, each with its own predicate written twice (once for
  the count, once for the filter). `RoutesList` takes 4 × 3 props for them and renders
  four near-identical checkbox blocks. Use one `ROUTE_FILTERS` table
  (`{ key, label, predicate, onlyWhen? }`) and drive state, counts, filtering and
  rendering from it. Invalid and under-repair are OR'd with each other; the rest are
  AND'd. Also: `RoutesList`'s `routes` prop is passed in but never read.

- [ ] **`useAdminLayerVisibility` + `AdminLayerControls` as a table** (~70 lines). Six
  `useState` pairs and a 12-prop interface could be one `Record<LayerKey, boolean>`,
  a `toggle(key)`, and a `{ key, label, layerIds }` list. The effect that applies
  visibility and the controls' `layers` array would both read from that list.

- [ ] **Map interaction modules** (~120 lines across `userMapInteractions.ts` and
  `adminMapInteractions.ts`):
  - The admin map's route popup body (title + badges + note + website) and station
    body duplicate `buildRouteBody` / `buildStationBody` in the user map. Move both
    into `tooltipFormatting.ts`.
  - The `<a … style=…>Website/Source</a> (double-click to open)` markup is written 3
    times. Make it a `popupLink(href, label, hint?)` helper.
  - The admin map has four hover popups, each with its own `let popup` and the same
    remove/create code. One `showHover(lngLat, className, html)` would replace them.
    The feature-state hover tracking for parts and notes is also duplicated.
  - In the user map, the three cursor enter/leave pairs are identical. The `on` and
    `off` registration lists repeat each other, so one `[event, layer, handler]` table
    can drive both. The route-layer list + `queryRenderedFeatures` call is built twice
    (`handleRouteClick`, `handleDblClick`).
  - `formatRouteMetadataBadges({ usage_type, line_class, frequency })` copies three
    fields out of `properties`; passing `properties` directly does the same.

---

## Medium

- [ ] **`useUserMap` follow-ups** (from the review of the shared-map refactor).
  - `routesSource` and `rebuildOn` have to be kept in step by hand: a value the
    source factory captures rebuilds the map only if the caller also lists it in
    `rebuildOn`, and neither tsc nor Biome checks the spread. Pass the source's
    inputs as data (e.g. `rides` + cache-buster ref) and derive the rebuild keys in
    the hook.
  - On login/logout progress is fetched twice: `dataAccess` changes first (request
    with the visitor's countries), then `RailwayMap`'s user-change effect sets the
    account's countries (second request). The first is discarded but still costs a
    round trip. This was already the case with `useRouteEditor`.
  - If the newest progress request fails, the box keeps figures for an older
    country filter with nothing saying so. Consider a quiet "couldn't update" state.

- [ ] **`dataAccess.ts`** (~90 lines).
  - `getJourneyCount` / `canAddMoreJourneys` are on the `DataAccess` interface with
    three implementations, and nobody calls them through it. Callers use
    `localStore.*` directly. Remove them.
  - The local `getUserProgress` / `getProgressByCountry` repeat the
    `reduce((sum, r) => sum + (Number(r.length_km) || 0), 0)` five times. Use a
    `sumKm(routes)` helper.
  - The all-zeros `UserProgress` literal is written 4 times (`progressQueries`,
    `publicMapActions`, `dataAccess` ×2). Make it one `EMPTY_PROGRESS` constant in a
    shared module. `Math.round(x * 10) / 10` repeats too, and `round1` already exists
    in `progressQueries.ts`.
  - The database and public implementations are `async f() { return await g() }`
    wrappers. Write them as `f: (…) => g(…)`.

- [ ] **Scripts bootstrap** (~40 lines). Eight scripts repeat `dotenv.config()` +
  `getDbConfig()` + `new Pool(...)`. `dbConfig.ts` exports both `getDbConfig()` and
  `dbConfig` only because of ESM import ordering. Put `import "dotenv/config"` at the
  top of `dbConfig.ts` (`serverData.ts` already does this), drop `getDbConfig`, and let
  scripts import `pool` from `@/lib/db`. That is the pattern CLAUDE.md already
  prescribes for migrations, which `markAllRoutesInvalid.ts`, the stated reference,
  doesn't follow.

- [ ] **`db.ts`'s `query()` wrapper** (~10 lines, plus typing). It does
  connect/query/release, which is exactly what `pool.query` already does, and it loses
  `pool.query<T>`'s row typing. It is used in 8 modules. Replace with `pool.query`.

- [ ] **`verifyRouteData.ts`** (~50 lines).
  - Inline `recalculateRoute` into `recalculateGeometry`. Its
    `{ success, coordinates, error }` shape exists only to be unpacked one call later,
    and the function is exported but used only in this file.
  - `RouteRow` and `ScenicLineRow`, and their two coordinate `SELECT`s, share a base
    type and a column fragment.
  - The "refresh station proximity and log the count" block is copied between
    `verifyRoutes()` and `importMapData.ts` step 3. Give it a helper in
    `stationProximity.ts`.
  - The `COUNT(*)` pre-check in `verifyAndRecalculateRoutes` adds nothing:
    `recalculateAllRoutes` over zero rows already does nothing.

- [ ] **Admin sidebar plumbing** (~60 lines).
  - `AdminSidebar.handleEditGeometry` re-fetches the route with `getRailwayRoute`,
    plus a request counter and a stale-check, and has `EditingGeometry.routeInfo: null`
    as a loading state. But Edit Geometry is only reachable from the edit form of the
    selected route, whose detail the page has already loaded. Use that detail and drop
    the fetch and the race guards.
  - The `showError` prop (AdminSidebar, with a fallback to `useToast`) and the
    `showSuccess`/`showError` props on AdminMap are all the same toast. Call
    `useToast()` directly.
  - `handleRouteDeleted` and `handleRouteUpdated` in `AdminPageClient` are identical.
  - The four tab buttons in `AdminSidebar` can be mapped from a list.
  - `AdminCreateRouteTab` takes the picked points as two values and two setters, while
    `AdminScenicTab` takes the `CreateFormCoordinates` object and its setter. Use the
    object form for both.

- [ ] **Single-flight save guard** (~30 lines). `AdminCreateRouteTab` repeats the
  `savingRef` + `isSaving` set/reset dance in both handlers. `AdminScenicTab` already
  has the same thing as its `run()`. Extract a small `useSingleFlight()` hook and use
  it in both.

- [ ] **Admin action helpers** (~40 lines).
  - `requiredStations()` exists in both `adminRouteActions.ts` and
    `adminScenicLineActions.ts`, differing only in a noun.
  - `pointWKT` exists in the scenic actions, while `saveRailwayRoute` builds `POINT(…)`
    inline.
  - Coordinates are read back as `ST_AsGeoJSON(...)::json` and then mapped from
    `{ coordinates }` to a tuple in three places (route detail, scenic lines, notes'
    `rowToNote`). Selecting `ARRAY[ST_X(p), ST_Y(p)]` (or one shared column helper)
    would remove the row types and the mapping.
  - `saveRailwayRoute`'s INSERT puts every column and every `$n` on its own line
    (~40 lines). Its "Create LineString geometry from coordinates"-style comments
    repeat the code, and `pathResult.hasBacktracking || false` appears 3 times.
  - `getAllRouteEndpoints` runs `JSON.parse` on `ST_AsGeoJSON` and has two
    near-identical start/end blocks. Use `::json` and loop over the two endpoints, or
    build the FeatureCollection in SQL.
  - `adminNotesActions.ts` repeats the 7-column note select/RETURNING list 4 times.
    Make it a `NOTE_COLUMNS` constant.

- [ ] **`countryUtils.ts`** (134 → ~20 lines). Both callers pass
  `{ type: "LineString", coordinates }`. Make it
  `getRouteCountries(coords: [number, number][])` that looks up the first and last
  points. This removes the union geometry type, `getStartCoordinate` /
  `getEndCoordinate` with their try/catch and warnings, and the JSDoc.

- [ ] **`tileSources.ts` + `map/index.ts`** (~70 lines). There are seven
  `xTileUrl` / `createXSource` pairs with the same shape. Use one
  `vectorSource(url, ZOOM_RANGES.x)` and one `tileUrl(base, name, cacheBuster?)`, and
  give each source a one-line factory. The web bindings in `map/index.ts` shrink the
  same way.

- [ ] **`layers.ts`: three route line factories → one** (~60 lines).
  `createRailwayRoutesLayer`, `createRailwayRoutesSpecialLayer` and
  `createRailwayRoutesHeritageLayer` differ only in id, visibility, dash, cap and
  filter. A single `routeLineLayer(id, config, { dash?, roundCap?, usageType?, hidden? })`
  would cover all three.

- [ ] **SQL tile functions** (~100 lines in `02-vector-tiles.sql`). Each point/line
  tile is a plpgsql block (`DECLARE result; tile_envelope := …; SELECT INTO; RETURN`)
  that could be a one-statement `LANGUAGE sql` function. `stations_tile` and
  `public_stations_tile` are the same function apart from `near_route`, so they can
  share a body. Some comments are stale: "matching Leaflet behavior", and "Only show
  stations at zoom 8+" above `z >= 9`.

- [ ] **Shared `<Icon>`** (~120 lines). There are 16 inline `<svg>` elements in
  Navbar (5), MenuSheet, ThemeSwitch, MapStationSearch (2), ShareMapDialog,
  MobileBottomSheet, CardHeader, UserSidebar and RouteEditForm. Most use the same
  24×24 stroke template, each at ~13 lines. `MenuSheet` already has a local
  `Icon({ path })`; move it to `components/ui/Icon.tsx` and use it everywhere. The two
  Navbar hamburgers are also identical copies.

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

## Dead code (small, safe)

- [ ] `constants.ts`: `isPublicNoteType` and the `public` field on `noteTypeOptions`.
  Nothing reads them; public visibility is the hard-coded `note_type = 'Usage'` in SQL.
  CLAUDE.md mentions `isPublicNoteType`.
- [ ] `basemap.ts`: `BASEMAP_FONT`. Only `BASEMAP_FONT_BOLD` is used.
- [ ] `highlightLayers.ts`: the `HighlightBaseId` type.
- [ ] `style.ts`:
  - `COLORS.railwayParts.selected` is unused.
  - `COLORS.railwayRoutes.default` and `.unvisited` are identical.
  - `WIDTHS.clickBuffer` repeats the same value for each line class. The click buffer
    is Regular-only, so the special multiplier never applies and it could be a scalar
    interpolate.
- [ ] `package.json`: the `deployValidMapData` script is the same as
  `deployMapData -- --valid-only`, and CLAUDE.md doesn't document it.
- [ ] **~50 exports used only in their own file** (drop the `export` keyword):
  - `verifyRouteData.ts`: `recalculateRoute`, `recalculateAllRoutes`, the result and
    options types, `DEFAULT_RECALC_CONCURRENCY`
  - `basemap.ts`: `latinizeLabels`, `flattenBuildings`, `filterPointsFromParkOutlines`,
    `BASEMAP_STYLE_URLS`
  - `countryUtils.ts`: `getStartCoordinate` / `getEndCoordinate` /
    `getCountryFromCoordinates` (removed anyway by the rewrite above)
  - `theme/index.ts`: `THEME_STORAGE_KEY` / `THEME_COLOR_META_NAME` /
    `readThemePreference`
  - `routeQueries.ts`: `searchLinesByName`
  - `api/response.ts`: `errorResponse`
  - …and about 30 types

  Re-run the scan to get the full list. (The scan: list every
  `export function|const|type` under `src/` and count word-boundary hits in every
  other file under `src`, `tests`, `mobile/src` and `mobile/app`.)
- [ ] Manual plurals (`x !== 1 ? "s" : ""`) where `plural()` exists: `RoutesList`,
  `LoginForm`.

---

## Verify before removing

- [ ] **verify** `migrateScenicLines.ts`, its npm script, and the matching CLAUDE.md
  entries. It is a one-off migration (2026-10). Once it has run on the server, it is
  dead weight.
- [ ] **verify** The one-time migrations inside `02-vector-tiles.sql`, which is
  re-applied on every deploy:
  - `ALTER TABLE admin_notes ADD COLUMN note_type / source` and the CHECK re-add (both
    are in `01-schema.sql` now)
  - `DROP FUNCTION route_is_fully_ridden`
  - the `IF EXISTS admin_notes` / `IF EXISTS scenic_lines` guards: `admin_notes` is in
    `01-schema.sql`, and `scenic_lines` exists once the migration has run

  Check that the server's schema has them, then delete.
- [ ] **verify** `GET /api/v1/routes` (every route *with geometry*, ~50MB for
  Europe). No client calls it. The web app replaced its equivalent with
  `routeSummariesInRegion` for exactly that size. If MOBILE_APP_PLAN.md doesn't need
  it, drop the handler, `routesInRegion`, and the API.md row. Several other endpoints
  (`/journeys/:id/*`, `/trips/:id`, `/coverage/stretches`, `/routes/track-ids`,
  `/journeys/unassigned`) have no mobile caller yet either. They are presumably planned
  phases, so leave them.
- [ ] **verify** `listStations` — a debug script that lists distinct
  from/to names. Delete it if it's no longer used.
- [ ] CLAUDE.md's paragraph on loading the old `.sql` exports by hand. Drop it once
  none of those files are kept anywhere.

---

## Docs

- [ ] **CLAUDE.md is ~150KB (~37k tokens), loaded into every session.** The biggest
  sections are "Key architectural decisions" (38KB) and "Map styling" (18KB). Much of
  it repeats, nearly word for word, the rationale comments already in the code. For
  example, the MapLibre Native `bad_alloc` story is in CLAUDE.md, `userRouteStyling.ts`,
  `AdminMap.tsx`, `layers.ts` and MOBILE_APP_PLAN.md. It also narrates history in ~50
  places ("used to", "once"). Trim each section to the rule plus a pointer to the file
  that explains it. Keep the commands, invariants and gotchas; let the code comments
  carry the reasoning.
- [ ] **`ZOOM_CONFIGURATION.md` is stale.** It points to `ZOOM_RANGES` in
  `src/lib/map/index.ts`, says stations show from zoom 10, and refers to an "OSM
  background". The header of `zoomRanges.ts` now covers the subject. Delete it, or
  shrink it to a line in CLAUDE.md.
- [ ] Local only: `mobile-spike/` is an untracked leftover containing nothing but
  `node_modules`. Delete it from disk.

---

## Comment noise (do it alongside the edits above, not as its own pass)

- [ ] Delete comments that repeat the next line: "// Handle save route functionality",
  "// Trigger map refresh", "// Calculate totals", "// Remove hover from previous
  part", "// Cleanup function", and so on. They are concentrated in
  `LocalJourneyLogTab`, `adminMapInteractions`, `AdminRoutesTab`,
  `AdminCreateRouteTab` and `dataAccess`.
- [ ] Replace `if (onX) { onX(); }` with `onX?.()`, and `onX || (() => {})` with an
  optional prop. Same files.
