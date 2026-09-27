# TODO.md

Audit of the codebase on 2026-09-25 (at `87eed52`). **Delete an item once it is
done**; if one turns out to be wrong or deliberate, delete it too and, where the
reasoning is worth keeping, move a sentence into `CLAUDE.md`. Delete the file when
it is empty. Line numbers are as of that commit and will drift.

Baseline: `npx tsc --noEmit` and `npm run lint` are clean. The items the previous
audit (`AUDIT.md`, closed in `7932aa7`) raised are not repeated here.

---

## Bugs — user-facing

- [ ] **Admin action errors are unreadable in production.** The admin actions
      (`adminRouteActions.ts`, `adminMapActions.ts`, `adminNotesActions.ts`)
      reject by throwing `Error("Route not found")` and the like, and
      AdminPageClient/AdminRoutesTab show `error.message` — which a production
      build replaces with "An error occurred in the Server Components render…".
      **Fix:** return `{ error }` for the expected rejections, as
      `login`/`register` now do (`asAuthResult` in `authActions.ts`).

- [ ] **`isRegionId("constructor")` is true.** `src/lib/shared/regions.ts:132` uses
      `value in REGIONS`, which walks the prototype chain.
      `/shared/<token>?view=constructor` crashes the shared page for whoever opens
      it, and `/api/v1/routes?region=toString` returns a 500 instead of a 400.
      **Fix:** `Object.hasOwn(REGIONS, value)`.

- [ ] **A failed country-filter save is silent, and rapid toggles can save an
      older list.** `src/components/map/RailwayMap.tsx`, `handleCountriesChange`.
      The map and stats switch to the new list at once, but a failed
      `updateUserPreferences` (network, expired session) is only logged, so the
      next load quietly reverts it. Toggling fast sends concurrent saves that can
      land out of order. **Fix:** toast on failure; serialise the saves (or send
      only the latest after the previous one settles).

- [ ] **Out-of-order async responses overwrite newer ones.** The same missing
      request-id guard appears in four places:
      - `JourneysAndTripsTab.tsx:55-78`: a slow filtered query lands after the
        search box was cleared. The same happens with fast Prev/Next. Also, `page`
        is never clamped, so deleting the last item on page 3 of 3 shows
        "Page 3 of 2" over an empty list.
      - `JourneyPlanner.tsx:64-80`, `:225-280`: `searchResults` is shared by
        from/via/to with no staleness check, and the debounce timer is not
        cleared on blur. Tabbing From→To quickly shows From's stations under To.
        `handleFindPath` also has no guard, so a path found after a region switch
        paints gold highlights from the old region.
      - `src/lib/map/hooks/useStationSearch.ts:21-45`: "Pra" results can replace
        "Praha hl.n.", and the older call's `finally` turns the spinner off
        early.
      - (possible) `AdminRoutesTab.tsx:164-200`: click A then B quickly; if A's
        response lands last, the map flies to A.

      **Fix:** a request counter in a ref per call site, ignoring any response
      that isn't the latest. Clamp `page` to `totalPages`.

- [ ] **JourneyCard can hang on "Loading…", and a partly failed save can't be
      retried cleanly.** `src/components/logbook/JourneyCard.tsx:124-161`,
      `:186-279`. The open-effect IIFE has no try/catch, so a failed
      `getJourney` leaves `isLoadingDetails` true for good. `handleSave` runs meta
      → trip → add → per-route remove → per-route partial as separate actions and
      returns at the first error without refreshing its snapshot or calling
      `onChanged`. **Fix:** try/catch/finally around the load. Move the diff into
      one server action applied in a single transaction.

- [ ] **An open journey card that leaves the list keeps its map edit session.**
      `JourneyCard.tsx:165-172`; `JourneysAndTripsTab.tsx:44`, `:121-127`. The
      session ends only from an effect that runs while `isOpen` is false, never
      on unmount. If you open a journey and then search for something with no
      hits, map clicks keep toggling routes on an invisible journey. **Fix:**
      return `onJourneyEditEnd` from the open effect's cleanup, and reset
      `openItem` when `page` or the search changes.

- [ ] **A via station pins the next leg to the route that arrived there.**
      `src/lib/routePathFinder.ts:1134-1143`. `previousEndRoute` is always one
      of `routeSequence[i]`, so the "if possible" `includes` test is always true
      and every leg after a via is seeded only from the arriving route. At a via
      where line 1 and line 2 cross mid-route, the second leg must leave line 1
      through an endpoint, which gives a detour or "No path found for segment 2"
      even though line 2 serves the via directly. That route is also reported
      whole although it was only partly ridden. **Fix:** seed from every route
      near the via, and let `computeTravelledTrims` trim routes entered or left
      mid-way at a via, not only the first and last.

- [ ] **from == to returns a whole route at full length.**
      `src/lib/routePathFinder.ts:704-715`, `:1000-1005`. The direct finish costs
      0, and the zero-width trim (`hi - lo <= 0`) is discarded as "whole", so
      `totalDistance` is the route's full length. Neither the action nor
      `/api/v1/planner` rejects it. **Fix:** refuse from == to up front, and treat
      a zero-width trim as 0 km.

- [ ] **Registration stores the country filter unnormalized.**
      `src/lib/authQueries.ts:96-104`. The `localPreferences` argument of the
      `register` action is client-supplied and goes straight into
      `selected_countries`, which breaks CLAUDE.md's "every write goes through
      `normalizeCountryCodes`". **Fix:** call
      `updateSelectedCountriesForUser(user.id, localPreferences)`.

- [ ] **The API returns 500 for input API.md says is a 400.**
      `src/app/api/v1/journeys/route.ts:26-35`, `journeys/[id]/route.ts:31-37`,
      `journeys/[id]/routes/route.ts:23-29`. `date` is only checked to be
      non-empty, and unknown `trackId`/`tripId` values reach Postgres. **Fix:**
      validate `YYYY-MM-DD` in `params.ts`, and map FK violations (23503) and bad
      dates (22007/22008) to `ValidationError`/not-found. Also make duplicate
      track ids consistent: create keeps the first, add keeps the last.

- [ ] **API.md documents two endpoints that don't exist.** `API.md:78`
      (`POST /coverage/stretches`) and `:88` (`GET /coverage`). There is no
      `src/app/api/v1/coverage`, and `requireCoveredRanges`
      (`src/lib/api/params.ts:177-189`) has no callers. **Fix:** add the two thin
      handlers, or remove the rows and the validator.

## Rare correctness issues

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

- [ ] **Tile functions are declared `IMMUTABLE` but read live tables.**
      `02-vector-tiles.sql:91`, `:274`, `:317`, `:366`, `:475`, `:516`. The planner
      may constant-fold them. It is harmless today only because of how Martin
      prepares its queries. **Fix:** `STABLE PARALLEL SAFE`, as Martin's docs use.

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
