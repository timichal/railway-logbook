# TODO.md

Audit of the codebase on 2026-09-25 (at `87eed52`). **Delete an item once it is
done**; if one turns out to be wrong or deliberate, delete it too and, where the
reasoning is worth keeping, move a sentence into `CLAUDE.md`. Delete the file when
it is empty. Line numbers are as of that commit and will drift.

Baseline: `npx tsc --noEmit` and `npm run lint` are clean. The items the previous
audit (`AUDIT.md`, closed in `7932aa7`) raised are not repeated here.

---

## Rare correctness issues

- [ ] **A failed `ROLLBACK` hides the error that caused it.**
      `saveRailwayRoute`, `duplicateRailwayRoute` and `deleteRailwayRoute` in
      `src/lib/adminRouteActions.ts` `await client.query("ROLLBACK")` in their
      catch. If the connection has died, that rejects and replaces the original
      error, a `ValidationError` meant for the admin included. The client is
      then released to the pool as healthy. **Fix:** catch the rollback's own
      failure, rethrow the original, and `client.release(err)` so the pool
      destroys the connection.

- [ ] **`mergeLinearChain` can build a route backwards.**
      `src/lib/coordinateUtils.ts:57-82` with
      `src/scripts/lib/railwayPathFinder.ts:896-913`. The start sublist is chosen
      by endpoint frequency, not path order. When the start coordinate is exactly
      a shared node, the first part truncates to `[N, N]`, no endpoint of the
      first two sublists is unique, and the merge starts from the far end. The
      stored geometry is then reversed: countries swap, and a recalculation that
      flips direction mirrors every user's `covered_*` fractions. This probably
      needs a click point snapped to a vertex, such as an existing endpoint dot.
      **Fix:** callers already pass sublists in path order, so start at index 0
      and drop zero-length truncated parts.

- [ ] **Planner backtracking detection uses guessed junctions.**
      `src/lib/routePathFinder.ts:510-536`, `:1171`. `hasRoutePathBacktracking`
      goes through `isBacktrackingTransition` (closest pairing) instead of the
      `SearchResult.sides` the search reports. A false negative skips the
      `avoidBacktracking` re-search. **Fix:** check each hop with the reported
      sides, keeping the pairing only as the fallback for null sides.

- [ ] **The GeoJSON stream reader misses truncation at a feature boundary.**
      `src/scripts/lib/geojsonFeatureStream.ts:144-145`. `truncated` is only set
      when the leftover buffer starts with `{`, so input cut right after `},`
      reads as complete. `loadRailwayData`'s `]}` tail check covers the import,
      but `pruneData` (stdin) does not have that check. **Fix:** require the
      depth-0 `]` that closes `features`.

- [ ] **The maskable icon's art is about 20% too small.**
      `src/scripts/generateAppIcons.ts:74`. `sharp(...).trim().metadata()` reports
      the input header, not the trimmed output, so `aspect` comes out as 1.
      **Fix:** `toBuffer({ resolveWithObject: true })` and read `info`.

- [ ] **The service worker's static cache grows forever.** `public/sw.js:68-77`.
      Every deploy's hashed chunks accumulate until `CACHE_VERSION` is bumped by
      hand. Eviction under storage pressure is per origin, so it can take the
      anonymous user's localStorage journeys with it. **Fix:** prune on activate
      (drop entries not from the current build id) or cap the cache as an LRU.

- [ ] (possible) **The non-backtracking admin search can prune the clean
      alternative.** `railwayPathFinder.ts:342-443`. `wouldCreateBacktracking`
      orients a part only from the next part, so a path can enter and leave a
      stub through one node and claim `bestDistance` before the final
      `findBacktracking` rejects it. That flags `has_backtracking` although a
      clean path exists. This needs a synthetic test case to confirm.

- [ ] (possible) **Routes with NULL `length_km` are free in the planner.**
      `routePathFinder.ts:641`, `:785` cost them `?? 0`, so the search can route
      over them until a recalculation backfills the length. This goes away with
      the NOT NULL item under "Database design".

- [ ] **Admin note writes are validated only in the popup.**
      `createAdminNote`/`updateAdminNote` (`src/lib/adminNotesActions.ts`) pass
      text and type straight to Postgres, and every export of a `"use server"`
      module is an endpoint. A blank text or an unknown `noteType` fails on a
      constraint and reaches the admin as the generic production error.
      **Fix:** throw `ValidationError` for a blank text or a type outside
      `noteTypeOptions`.

## Database design

- [ ] **Add the missing constraints.** `database/init/01-schema.sql:53-70`,
      `:102-103`.
      - `user_logged_parts.track_id` is nullable, which forces
        `track_id IS NOT NULL` into several queries and means the unique
        `(journey_id, track_id)` index does not dedupe NULLs.
      - `partial`, `is_valid`, `scenic`, `under_repair`, `has_backtracking` and
        `frequency` have defaults but allow NULL. A NULL `partial` (the action
        passes client booleans through) is neither whole nor partial in
        `user_fully_ridden_routes`.
      - There is no CHECK on `usage_type IN (0,1,2)`, and no format check on the
        country codes, `selected_countries` included.

      Add these with a migration script following `markAllRoutesInvalid.ts`.

- [ ] **Drop redundant and dead indexes and columns.** `01-schema.sql:160-177`.
      - `idx_logged_parts_user_id` duplicates the prefix of
        `…_user_track_partial`.
      - `idx_logged_parts_journey_id` duplicates the prefix of the unique index.
      - `idx_user_journeys_user_id` duplicates the prefix of `…_user_date`.
      - `idx_user_journeys_date` is unused.
      - `starting_part_id`/`ending_part_id` are deprecated, only ever written as
        NULL, and still indexed. They and the admin-only `error_message` are
        still shipped in every *public* route tile (`02-vector-tiles.sql:215-218`).

- [ ] **Give `railway_routes` an `updated_at` trigger.** The planner's graph
      cache fingerprint (`routePathFinder.ts:363-379`) depends on every write path
      remembering to set it. None misses it today, but other tables have the
      trigger and this one doesn't. A transaction-start timestamp can also commit
      out of order with a concurrent write (for example an admin save during
      `verifyRouteData`) and leave `max(updated_at)` unchanged. Consider also
      folding a sequence or `txid` into the fingerprint.

- [ ] **Emails are case-sensitive.** `src/lib/authQueries.ts:40`, `:82`. "Foo@x"
      and "foo@x" become two accounts, and a concurrent register race surfaces
      as a 500 rather than "already exists". **Fix:** a unique index on
      `lower(email)`, normalize on write, and map 23505 to `ValidationError`.

## Refactoring

- [ ] **Share the station search and interaction setup between the two user
      maps.** `RailwayMap.tsx:395-498`, `:603-676` and
      `PublicRailwayMap.tsx:106-258` are about 150 lines copied near-verbatim:
      the input, the dropdown's pointerdown fix, the explicit blur, and the
      cancellable idle-deferred interaction setup ("See RailwayMap"). **Fix:**
      extract `<MapStationSearch>` and `useUserMapInteractions`. The local
      feature-state logic (`RailwayMap.tsx:185-217`, `:368-380`) could become
      `useLocalRouteFeatureStates`, which would bring RailwayMap down from 687
      lines.

- [ ] **Merge the logged-in and local logbook variants.** `JourneyLogger.tsx` and
      `LocalTripLogger.tsx` match line for line apart from the save call, trip
      select and banner. `JourneyCard.tsx:386-521` and
      `LocalJourneyLogTab.tsx:465-611` duplicate the edit form and route row (the
      same trash SVG included). The local copies still hard-code `/5`
      (`LocalJourneyLogTab.tsx:377`, `LocalTripLogger.tsx:85`) although
      `MAX_JOURNEYS` exists. **Fix:** extract `<JourneyMetaFields>`,
      `<SelectedRoutesList>`, `<LoggedRouteRow>` and `TrashIcon`, then build one
      `RouteLogger` that takes an `onCreate` strategy.

- [ ] **Nothing stops an admin call site from ignoring its result.** Admin
      actions return their refusals as `{ error }` (`asAdmin`,
      `src/lib/authHelpers.ts`). A call that forgets `unwrap`, such as
      `await deleteAdminNote(id); showSuccess(…)`, compiles, passes Biome, and
      reports a refused delete as done. The journey and trip actions' `{ error }`
      results carry the same risk. **Fix:** a lint rule (Biome GritQL plugin)
      that flags an `await` on an `@/lib/admin*Actions` import not wrapped in
      `unwrap`, or an ESLint-style "no floating result" check if Biome gains one.

- [ ] **`getAllRailwayRoutes` and `getRailwayRoute` are untyped.**
      `src/lib/adminRouteActions.ts`. They have no declared return type, so they
      infer `ActionResult<any>`, and `routeDetail.geometry`, `.length_km` and the
      rest are never checked against `RailwayRoute`. A renamed column compiles
      and fails at runtime. **Fix:** declare the row types (the detail one adds
      the parsed coordinates) as their siblings do.

- [ ] **The admin route metadata form is written twice.**
      `AdminCreateRouteTab.tsx:374-531` and `RouteEditForm.tsx` repeat every
      field with identical ~110-character input class strings (10 and 8 copies).
      The preview-route shape is restated in `AdminPageClient.tsx`,
      `AdminSidebar.tsx`, `AdminCreateRouteTab.tsx` and `AdminMap.tsx`. **Fix:**
      `<RouteMetadataFields>`, `PathPreview` declared once (`NewRouteData` in
      `AdminCreateRouteTab.tsx` already is), and a `useRoutePreview` hook, which
      also fixes the missing try/catch and stale-response handling in
      `handlePreviewRoute`.

- [ ] **Split the two ~1200-line pathfinders along their seams.**
      - `routePathFinder.ts`:
        - `routeGraph.ts`: graph, grid, loader, cache (`:80-404`).
        - `routeSearch.ts`: heap, `findShortestPath`, `terminalCost`,
          `resolveEntry`, bearings (`:410-804`). Pure code, and the part that
          most needs unit tests.
        - `plannerStations.ts`.
        - Split `computeTravelledTrims` into a pure spec and the SQL.
        - Pull the per-segment loop body (`:1145-1188`) out as `searchSegment()`.
      - `railwayPathFinder.ts`:
        - A `PartNetwork` (load, adjacency, lengths).
        - Pure part-geometry functions (`:650-959`). They are private methods
          today, so they can't be tested.
        - One `junctionAngle()` shared by `findBacktracking` and
          `wouldCreateBacktracking`.

- [ ] **Small shared helpers.**
      - The index-based worker pool is copy-pasted in `verifyRouteData.ts:267-297`
        and `showBacktracking.ts:121-145`; replace both with a `runPool()`.
      - The `ST_DWithin(geometry_3857, …, m / GREATEST(cos(radians(lat)), 0.01))`
        fragment appears three times: `routePathFinder:169`,
        `railwayPathFinder:103`, `stationProximity:25`.
      - The per-journey stats SELECT is copy-pasted four times in
        `tripQueries.ts` (`:158`, `:438`, `:461`, `:517`). Make it one fragment
        like `TRIP_STATS_SELECT`.
      - `mobile/src/region/RegionContext.tsx:16-28` restates `DEFAULT_REGION` and
        `isRegionId` instead of taking them from `@shared/regions`, so a changed
        default would reach the web app but not the native one. Its hydration
        can be `setRegionId(regionIdOrDefault(stored))`.

- [ ] **A `useAsyncLoad` hook for the cancellable load effect.** The
      `let cancelled = false` / `.then` / `.catch` / `.finally` / cleanup pattern
      is written out by hand in `CountriesStatsTab.tsx`, `ShareMapDialog.tsx`,
      `LocalJourneyLogTab.tsx` (region track ids), `JourneyCard.tsx` (journey
      details) and `useCoverageOverlay.ts`. Every copy has to get each guard
      right by itself, and they don't agree: some copies log a failure for a
      request that was already cancelled, and only `CountriesStatsTab` and
      `ShareMapDialog` show the user that a load failed. **Fix:**
      `useAsyncLoad(fn, deps)` returning `{ data, loading, error, retry }`, which
      clears `data` whenever deps change so a failed load can't leave the
      previous account's or region's result on screen. `JourneyCard` and
      `useCoverageOverlay` act on the result rather than only storing it, so they
      may want an `onData` callback or may simply stay as they are. The
      `cancelled` flags in `RailwayMap`, `PublicRailwayMap` and `useMapLibre` look
      the same but guard deferred map setup, not a load, so they are out of
      scope.

- [ ] **Style values hard-coded outside `style.ts`.**
      - The dark ground `#05070a` is written twice in `basemap.ts` (`:204`,
        `:371`), and the two must match.
      - Railway-parts widths are inline at `src/lib/map/index.ts:437-446`.
      - Default route and click widths (3 and 16) are inline at `index.ts:134`,
        `:171`, `:209`, `:248`, `:277`.
      - Line-class, scenic and frequency badge colours are inline in
        `tooltipFormatting.ts:167-192`.
      - There is also an empty duplicate "OPACITIES" banner in `style.ts`.

- [ ] **There are no tests at all.** The riskiest logic is pure and easy to cover:
      - `routeCoverage.ts`: `isRouteFullyRidden` must agree with the SQL
        function.
      - `parsePgTextArray`.
      - `mergeLinearChain`: see the reversal item above.
      - `geojsonFeatureStream`: see the truncation item above.
      - `normalizeCountryCodes`.
      - The planner's search on a synthetic network, once it is split out.

      `node --test` with tsx needs no new dependency.

## Frontend: accessibility and consistency

- [ ] **Modals have no dialog semantics or focus management.**
      `src/lib/toast/ConfirmDialog.tsx:33-53`, `ShareMapDialog.tsx:114`,
      `MenuSheet.tsx:250-261`. None sets `role="dialog"`/`aria-modal`, moves or
      traps focus, or restores it on close. ConfirmDialog also ignores Escape,
      and the merge dialog opened over MenuSheet has Escape close the sheet
      underneath instead. **Fix:** build all three on native `<dialog>` with
      `showModal()`.

- [ ] **The share dialog's switch shows no keyboard focus.**
      `src/components/sharing/ShareMapDialog.tsx:153-166`. It is an `sr-only`
      checkbox with `peer-*` styling and no `peer-focus-visible:`, and
      `globals.css` deliberately leaves checkboxes out of its focus rule. It also
      re-implements `ui/ToggleSwitch`. **Fix:** use `ToggleSwitch`, giving it a
      `disabled` prop.

- [ ] **Station search inputs lack labels and roles.**
      `StationSearchInput.tsx:84-105`, `JourneyPlanner.tsx:422-449`,
      `JourneysAndTripsTab.tsx:225-231`, `LocalJourneyLogTab.tsx:383-389`.
      - The "×" clear/remove button has no `aria-label`; in a via row it deletes
        the stop.
      - The via inputs and the list search boxes are labelled only by a
        placeholder.
      - The suggestion list has no `combobox`/`listbox`/`option`/
        `aria-activedescendant`.

- [ ] **A few controls bypass `buttonStyles.ts`.**
      - The coordinate "×" buttons (`AdminCreateRouteTab.tsx:332`, `:363`) are
        hand-built, with no `not-disabled:` and no `aria-label`; use
        `iconBtn("sm", "danger")`.
      - `TagInput.tsx:277-279` appends text colours to `optionRow(...)`.
      - `TripCard.tsx:194` carries both `text-[10px]` and `text-xs`.

- [ ] **Decide one display format for journey dates.** Each display site picks
      its own locale, so one journey's date reads differently from one view to
      the next:
      - Browser locale (`toLocaleDateString()`): `JourneyCard.tsx:315`,
        `TripCard.tsx:179-187` (`formatDateRange`) and `:360`.
      - `cs-CZ`: `LocalJourneyLogTab.tsx:417`, the route popup
        (`userMapInteractions.ts:323`), and in the native app
        `mobile/src/map/FeatureSheet.tsx` (`formatJourneyDate`) and
        `mobile/app/(tabs)/logbook.tsx:332-339`.

      They all parse through `parseDateOnly` now, so none of them shows the
      wrong day; this is only about the format. **Decide** which locale (the
      viewer's, or a fixed one). **Then** add `formatDateOnly(value)` (and a
      range form) beside `parseDateOnly` in
      `src/lib/shared/getUntimezonedDateStr.ts`, which both apps share, and
      route every site through it, so that a new display can't go back to
      `new Date(str)`.

- [ ] **The admin colour expression breaks the paint-expression house rule.**
      `AdminMap.tsx:64-83` uses `["all", …]` inside a `case` that has further
      branches. That is harmless on GL JS, and the admin map is web-only, but
      CLAUDE.md says to keep every data-driven expression in the nested shape.
      Rewrite it, or note the exemption in CLAUDE.md.

## Docs

- [ ] **CLAUDE.md's station label sizes are stale.** CLAUDE.md says "size 10
      stepping to 11 at z16". `LABELS.station.size` in `src/lib/shared/map/style.ts` is
      13/14.

## Possible, needs checking

- [ ] A map rebuilt for a region or scheme change builds its route source with
      no `v`, although `useMapTileRefresh` may have moved on to a later one: the
      initial `appliedRef` claims construction stands for the current refresh.
      Harmless while the route tile handler answers `private, no-store` and
      `sw.js` never caches tiles; stale colours the moment either changes.
      **Fix, if needed:** reset `appliedRef` when the map instance changes (one
      extra reload per rebuild), or thread the cache buster into construction.
- [ ] `CountriesStatsTab.tsx:29-43` reloads `getProgressByCountry()` on every
      checkbox toggle, although the result doesn't depend on the selection.
- [ ] `localStorage.ts:55-56`, `:218-219` parse inside try/catch but don't check
      the shape. A stored `{"journeys":{}}` would crash `.filter` in the tabs.
- [ ] `loadBasemapStyle` shares its memoised layer *objects* across every map
      instance (`useMapLibre` spreads the array, not the objects). If MapLibre
      mutates specs in place, state leaks between the admin and user maps.
