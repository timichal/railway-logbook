# TODO.md

Audit of the codebase on 2026-09-25 (at `87eed52`). **Delete an item once it is
done**; if one turns out to be wrong or deliberate, delete it too and, where the
reasoning is worth keeping, move a sentence into `CLAUDE.md`. Delete the file when
it is empty. Line numbers are as of that commit and will drift.

Baseline: `npx tsc --noEmit` and `npm run lint` are clean. The items the previous
audit (`AUDIT.md`, closed in `7932aa7`) raised are not repeated here.

---

## Security (do these first)

- [ ] **The route tile serves any user's ride history to anyone.**
      `database/init/02-vector-tiles.sql:186`, `:238-253`;
      `martin/configuration.yml:27-34`; `src/lib/map/index.ts:110`.
      `railway_routes_tile` takes `user_id` straight from the query string and
      returns that user's `journey_name`, `date`, `partial` and `has_complete_trip`
      on every route. Martin is reached directly through `/tiles`, with no session
      involved, and ids are SERIAL, so
      `GET /tiles/railway_routes_tile/6/34/21?user_id=7` shows user 7's logbook
      whether or not they ever shared it. The shared page also hands every visitor
      the `ownerId`, so switching sharing off does not stop someone who has
      already opened the link. This contradicts CLAUDE.md ("`public_map_enabled`
      is the only thing that grants access", "turning sharing off kills the link
      immediately"). **Fix:** stop accepting a raw id. Either proxy the per-user
      tile through a Next route handler that resolves the session or share token
      and injects the id, or pass an opaque value the SQL resolves itself (the
      share token joined on `public_map_enabled`, plus a short-lived signed token
      for the owner's own map).

- [ ] **The admin tile sources are public.** `martin/configuration.yml:17-65`;
      `02-vector-tiles.sql:437-477`. `admin_notes_tile` returns every note,
      including the `Works`/`Todo`/`UsageInternal` drafts that `public_notes_tile`
      exists to hide. It is served from the same Martin instance under the same
      `/tiles` prefix the admin map fetches from the browser, and Martin's
      `/catalog` lists every source. The Caddyfile is not in the repo, so check
      it, but nothing here gates the path. **Fix:** put the admin sources behind
      an auth check (Caddy's `forward_auth` to an admin-check endpoint, or a Next
      proxy route), or run them from a second Martin instance that is not publicly
      routed.

- [ ] **A missing `JWT_SECRET` silently falls back to a published constant.**
      `src/lib/authTokens.ts:16-18`. The code reads
      `process.env.JWT_SECRET || "your-secret-key-change-in-production"`, and
      `docker-compose.yml` passes `JWT_SECRET=${JWT_SECRET}`, which is an empty
      string when the host variable is unset. dotenv does not override a key that
      already exists, even an empty one. Anyone who has read the repo can then
      forge `{ userId: 1 }`, which is admin, over the cookie and bearer paths
      alike. **Fix:** in production, throw at startup if the secret is unset or
      shorter than about 32 bytes.

- [ ] **Secrets are baked into the Docker image.** `Dockerfile:18` (`COPY . .`);
      `.github/workflows/deploy.yml:26-33`. CI writes `.env` with `DB_PASSWORD`
      and `JWT_SECRET`, and there is no `.dockerignore`. Next's standalone build
      copies `.env` into `.next/standalone`
      (`node_modules/next/dist/build/index.js:326-333`), so the runner image ships
      `/app/.env`. **Fix:** add a `.dockerignore` excluding `.env*`, `data/`,
      `node_modules` and `.next`, and drop the CI step that creates `.env`, since
      compose injects the environment anyway.

- [ ] **The frontend and Martin ports are published on every interface.**
      `docker-compose.yml:21` (`3001:3000`) and `:32` (`3000:3000`); only `db` is
      bound to `127.0.0.1`. Docker-published ports bypass ufw/iptables INPUT
      rules. A client that reaches `host:3000` directly controls `X-Real-IP`,
      which `clientAddress` trusts first (`src/lib/rateLimit.ts:116-127`), so
      sending a random value per request gets a fresh budget each time and the
      sign-in and registration caps go away. **Fix:** bind both as
      `127.0.0.1:…`.

- [ ] **Behind Caddy, `X-Real-IP` is client-controlled, so the rate limit is
      bypassable even through the proxy.** `src/lib/rateLimit.ts:116-127`.
      `clientAddress` prefers `X-Real-IP`, assuming the proxy sets it. That held
      for nginx with `proxy_set_header X-Real-IP $remote_addr`. Caddy's
      `reverse_proxy` never sets `X-Real-IP` and passes a client's own copy
      through unchanged, so `X-Real-IP: <random>` on each request gets a fresh
      budget. `X-Forwarded-For` is safe: with no `trusted_proxies` configured,
      Caddy discards the incoming value and sets it to the peer address, so the
      rightmost-hop logic still gives the real client. **Fix:** drop the
      `X-Real-IP` branch and read only `X-Forwarded-For`, which also fixes the
      doc comment above `clientAddress`. Alternatively, have the Caddyfile
      overwrite the header with `header_up X-Real-IP {remote_host}`. That keeps
      the code as is, but makes its safety depend on a file that isn't in the
      repo.

- [ ] **Any account holder can bypass the login rate limit.**
      `src/lib/rateLimit.ts:149-151`. A successful login clears the whole
      per-address counter. The loop is: register one account, then repeat nine
      wrong guesses against a victim and one correct login to your own account.
      The counter never reaches 10. **Fix:** on success, clear only the failures
      charged to that email (count per address+email as well as per address), or
      stop clearing on success and raise the cap instead.

- [ ] **`createJourney` files a journey under someone else's trip.**
      `src/lib/journeyQueries.ts:123-128`, reachable from `journeyActions` and
      `POST /api/v1/journeys` through `tripId`. `trip_id` is inserted without an
      ownership check, although `assignJourneyToTripForUser` does check.
      `tripInRegionSql` (`src/lib/tripQueries.ts:34-42`) does not filter by user
      either, so user A's journey changes which region B's trip is listed under,
      and the FK error versus success reveals which trip ids exist. **Fix:** check
      `user_trips.user_id` inside the transaction. As defence in depth, add
      `UNIQUE (id, user_id)` on `user_trips` and `user_journeys`, then composite
      FKs `(trip_id, user_id)` and `(journey_id, user_id)`, so the schema cannot
      hold a cross-user link.

- [ ] **The schema seeds the author's email and bcrypt hash into a public repo.**
      `database/init/01-schema.sql:17`. The hash can be cracked offline if the
      password is weak, and every fresh deployment gets that admin account.
      **Fix:** seed the admin from environment variables, or print a one-time
      setup step, and rotate that password if it is still in use anywhere.

## Bugs that lose or corrupt data

- [ ] **`importRouteData` wipes every other user's logged rides.**
      `src/scripts/exportRoutes.ts:211-214`. The dump runs
      `DELETE FROM public.railway_routes;` *before*
      `SET session_replication_role = replica`, so the delete cascades through
      `user_logged_parts.track_id … ON DELETE CASCADE` for **all** users. The dump
      then restores only user 1's parts, which leaves everyone else's journeys
      empty. **Fix:** at minimum, move the `SET` above the `DELETE`. Better:
      restore only the admin's rows and upsert routes by `track_id`. Either way,
      back up `user_logged_parts` first.

- [ ] **`importRouteData` is not atomic and reports success when SQL fails.**
      `src/scripts/importRoutes.ts:78-99`. psql runs without
      `-v ON_ERROR_STOP=1` or `--single-transaction`, and psql exits 0 when
      individual statements fail. A dump taken after a schema change can therefore
      commit the DELETE, fail every INSERT, and still print "SQL dump executed
      successfully". The dump's `setval('user_trips_id_seq', …)` lines always
      fail, because pg_dump clears `search_path` and these names are unqualified;
      that is why the later sequence resync is needed. **Fix:** add both psql
      flags and schema-qualify the generated statements.

- [ ] **Export shifts journey dates and timestamps on a non-UTC host.**
      `src/scripts/exportRoutes.ts:72-73`, `:106-108`, `:146`. node-pg parses
      `DATE` as local midnight, so `toISOString().split("T")[0]` gives the
      previous day in CET/CEST. `created_at.toISOString()` appends a `Z` that a
      `TIMESTAMP` column ignores. Each round trip on a Prague machine moves every
      journey back a day. **Fix:** select `date::text` and `created_at::text`, or
      see the pg type-parser item under "Bugs — user-facing".

- [ ] **A transient DB fault during recalculation marks a route invalid, and
      `--valid-only` never rechecks it.** `src/scripts/verifyRouteData.ts:67-88`.
      The try/catch wraps the whole of `findPathFromCoordinates`, including the
      part-loading query, so an error such as "Connection terminated unexpectedly"
      is written as `is_valid=FALSE` with that text as `error_message`. Deploys
      run `--valid-only`, so the route is never looked at again.
      `RECALC_PERFORMANCE.md` says a thrown error stops the run. **Fix:** catch
      only genuine pathfinding failures (a null result, "Chain is broken") and
      rethrow everything else. Guarding the unguarded `this.findPath(...)` in
      `findBestCoordinatePath` (`src/scripts/lib/railwayPathFinder.ts:733`) makes
      that split clean.

- [ ] **Partial-ride fractions are kept when a route's geometry changes.**
      `src/lib/adminRouteActions.ts:255-273` (geometry re-pick) and `:550-558`
      (duplicate). `covered_start`/`covered_end` are positions along the *old*
      line. Splitting A–C into A–B and B–C leaves a user who rode only A–B
      (stored as [0, 0.5]) showing the first half of B–C as ridden and A–B as
      only half done. The split case in CLAUDE.md holds for whole rides only.
      **Fix:** on a geometry change, re-project each range by taking the endpoints
      of `ST_LineSubstring(old, s, e)` and `ST_LineLocatePoint`ing them onto the
      new line, then clip or drop any range that no longer overlaps.

- [ ] **Migrating local journeys gets stuck on a deleted route.**
      `src/lib/migrationActions.ts:47-130`. The migration is not a transaction and
      throws on the first failed part insert. A localStorage part pointing at a
      `track_id` the admin has since deleted violates the FK, so every retry
      aborts at the same point and leaves half-imported, possibly empty journeys
      behind. Ranges also skip `sanitizeRange`. **Fix:** one transaction; skip
      and count parts whose route no longer exists; run ranges through
      `sanitizeRange`. Also consider the dedupe: matching on name+date merges two
      genuinely separate same-day journeys, such as an out-and-back.

## Bugs — user-facing

- [ ] **Sign-in and registration errors are unreadable in production.**
      `src/lib/authActions.ts:49-78`; `LoginForm.tsx:88`; `RegisterForm.tsx`
      (catch). `login`/`register` report rejections by *throwing*
      `ValidationError`/`RateLimitError`, and the forms show `err.message`. A
      production build replaces any message thrown from a server function with
      "An error occurred in the Server Components render…", so a wrong password,
      mismatched passwords and the 429 wait all show that sentence. The same
      applies to other `showError(error.message)` calls after thrown actions
      (AdminPageClient, AdminRoutesTab, JourneyLogger). The comment in `errors.ts`
      ("the web forms render `error.message` either way") only holds in dev.
      **Fix:** catch the two classes in the web actions and return `{ error }`,
      as the journey/trip actions already do (see
      `node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md`).
      Confirm with `npm run build && npm start`.

- [ ] **Signing in with local journeys leaves the menu stuck on "Signing in…".**
      `src/components/auth/LoginForm.tsx:36-81`. None of the merge dialog's three
      callbacks calls `onSuccess()`, and `setLoading(false)` only runs in the
      catch. The sheet stays open with the button disabled, and `onAuthSuccess`
      (switch to Route Logger) never fires. **Fix:** call `onSuccess()` in every
      branch and reset `loading` in a `finally`.

- [ ] **Journey dates reach the app as timezone-dependent `Date`s.**
      `src/lib/journeyQueries.ts:53`, `:123-126`, `:194-199`; the `uj.*` selects in
      `tripQueries.ts`. No type parser is set for `DATE` (OID 1082), so
      `types.ts`'s `date: string // YYYY-MM-DD` is untrue. Over the API a date
      serialises as e.g. `"2026-09-24T22:00:00.000Z"`, the previous day when the
      server runs at UTC+2. On the web, `getUntimezonedDateStr` then applies the
      *browser's* offset, and `JourneyCard` writes the shifted date back on save.
      Trip `start_date`/`end_date` already use `::text`, so the two are
      inconsistent. **Fix:** `types.setTypeParser(1082, v => v)` in `db.ts`. That
      also fixes the export item above.

- [ ] **The new-journey date defaults to the UTC day.**
      `src/components/logbook/JourneyLogger.tsx:36`, `LocalTripLogger.tsx:32` use
      `new Date().toISOString().split("T")[0]`. Before 02:00 in Prague or 09:00 in
      Japan the form prefills yesterday. **Fix:** use
      `getUntimezonedDateStr(new Date())`, computed when the form resets.

- [ ] **`isRegionId("constructor")` is true.** `src/lib/regions.ts:132` uses
      `value in REGIONS`, which walks the prototype chain.
      `/shared/<token>?view=constructor` crashes the shared page for whoever opens
      it, and `/api/v1/routes?region=toString` returns a 500 instead of a 400.
      **Fix:** `Object.hasOwn(REGIONS, value)`.

- [ ] **The ridden-stretch overlay is dropped if its data lands while tiles load.**
      `src/lib/map/hooks/useCoverageOverlay.ts:117-122`. `isStyleLoaded()` is
      false whenever any source is still fetching tiles, not just while the style
      loads (maplibre `style.ts:615-627`), and the fallback is `once("load")`,
      which fires once per map lifetime. Logging a journey refreshes the route
      source at the same moment it bumps `coverageVersion`, so a newly logged
      partial ride often does not appear. **Fix:** capture `map.current` at effect
      start, bail on mismatch, and call `syncCoverageOverlay` directly:
      `mapLoaded` already guarantees the style is loaded.

- [ ] **Selection and planner highlights vanish after a map rebuild.**
      `src/lib/map/hooks/useRouteHighlighting.ts:238-269`. Neither effect depends
      on `mapLoaded`, and `useMapLibre` rebuilds the map on a colour-scheme change,
      including an unprompted OS flip under "System". The sidebar still lists the
      selection, but the orange/gold overlay is gone. A country toggle makes this
      a race. **Fix:** pass `mapLoaded` in and add it to both deps arrays, as the
      sibling hooks already do.

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

## Bugs — admin

- [ ] **"Save Route" wipes the form when the save fails, and a double click
      saves twice.** `src/components/admin/AdminCreateRouteTab.tsx:181-201`;
      `AdminPageClient.tsx:171-203`. The parent catches every error and resolves
      normally, so the child always runs `resetForm()`. There is also no
      `isSaving` guard. **Fix:** return success (or rethrow) from `onSaveRoute`,
      reset only on success, and disable the button while saving.

- [ ] **Switching region brings back the old region's route preview.**
      `AdminPageClient.tsx:80-87`; `AdminSidebar.tsx:119-150`;
      `AdminCreateRouteTab.tsx:276-280`. The create-form coordinates are held
      twice. The region switch clears the parent's copy and leaves the sidebar's,
      so the auto-preview effect re-runs and re-enters preview mode with a
      European path on the Japan map, and "Save Route" would save it. **Fix:** a
      single owner for the coordinates, lifted into `AdminPageClient`.

- [ ] **Saving an invalid route's metadata leaves the "Invalid Route" banner up.**
      `AdminRoutesTab.tsx:244-248`. The server sets `is_valid=TRUE` and clears
      `error_message`/`under_repair`, but the client only merges the form fields.
      The under-repair toggle then hits `setRouteUnderRepair`, which refuses
      valid routes. **Fix:** re-fetch the route after saving.

- [ ] **After the first save, every route click refetches all route tiles.**
      `src/components/admin/AdminMap.tsx:244-283`. The refresh effect's only guard
      is `refreshTrigger === 0`, but its deps include `selectedRouteId` and
      `showRoutesLayer`. After any save, each selection or toggle removes and
      re-adds five layers with a fresh cache buster, so the whole network
      flickers and re-downloads. **Fix:** make `refreshTrigger` the only trigger
      and read the other two through refs.

- [ ] **That same refresh buries the station dots under the lines.**
      `AdminMap.tsx:267-271`. Routes are re-added with
      `beforeId: "station_labels"`, which puts them above the `stations` circles.
      **Fix:** use `"stations"`, as `useMapTileRefresh` does, and update the
      matching sentence in CLAUDE.md.

- [ ] **Admin layer toggles fall out of sync.** Unticking Stations hides the dots
      but not `station_labels` (`src/lib/map/hooks/useAdminLayerVisibility.ts:69`).
      The route-endpoints layer is recreated with default visibility after every
      save, so it reappears while its box reads unticked
      (`useAdminMapOverlays.ts:135-156`; use `setData` instead).

- [ ] **Notes popup: leaked React roots and redundant rebuilds.**
      `src/lib/map/hooks/useAdminNotesPopup.tsx`.
      - `root.unmount()` only runs from the popup's own Close. Outside-click,
        replacement by a new right-click and effect cleanup all leak the root
        (`:83`, `:149`, `:162`). Unmount from `popup.on("close")` via
        `queueMicrotask`.
      - The notes layer is rebuilt on mount, on every visibility toggle, and twice
        per save (`:169-186`, `:38-41`, `:114-117`).
      - (possible) After `await getAdminNote`, `map.current!` is dereferenced
        unchecked (`:67-102`).
      - (possible) Holding Ctrl+Enter in `NotesPopup.tsx:97-101` skips the
        `isSaving` check and can create duplicates.

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

## Performance

- [ ] **A country toggle, login or logout rebuilds the whole map, then refreshes
      tiles twice more.** `src/components/map/RailwayMap.tsx:161-176` (deps
      `[userId, effectiveCountries, region.id]`), `:385-392`, `:447-455`. Every
      checkbox in the Countries tab destroys the WebGL context and basemap.
      `handleCountriesChange` and the user-change effect then call `refreshTiles`
      anyway, racing the new map's load. This race is what makes the highlight
      bug above intermittent. **Fix:** drop both from the `useMapLibre` deps, let
      `refreshTiles` rebuild only `railway_routes` (lift its `!userId` gate), and
      delete the user-change effect.

- [ ] **Anonymous visitors download every route's full geometry two or three
      times per load.** `src/lib/dataAccess.ts:137-142`. `ensureRoutes` caches
      the resolved array, not the promise, so three mount-time callers each start
      `getAllRoutes(region)`, which returns `ST_AsGeoJSON` for every route. The
      progress calculation needs only id, length, usage and countries. **Fix:**
      `routesPromise ??= …`, plus a geometry-free query for this caller.

- [ ] **Recalculation grows the buffer when the click point is off the network.**
      `src/scripts/lib/railwayPathFinder.ts:262-270`. If no part is within 1 m at
      the 50 km buffer, none will be at 100 km or 222 km either, yet the loop
      `continue`s to both. This is the most common way a route breaks after an OSM
      update, and each such route pays for the largest load for nothing. This is
      not the forbidden "shrink the buffer" change. **Fix:** return null when
      either end matches no part.

- [ ] **Recalculation recomputes part lengths and adjacency inside its loops.**
      `railwayPathFinder.ts:401`, `:420-426`, `:1049-1062`, `:1082-1108`. Each
      relaxation re-sums haversines over the whole part, and
      `getConnectedPartIds` builds and sorts a Set per pop in a label-correcting
      search. **Fix:** precompute `lengthMeters` and sorted neighbours in
      `parseAndStoreParts`. Visit order is unchanged, so check with the
      RECALC_PERFORMANCE regression diff.

- [ ] **The hover popup is destroyed and rebuilt on every mousemove.**
      `src/lib/map/interactions/userMapInteractions.ts:181-187`, `:446-469`.
      **Fix:** keep the popup and the last feature id. On the same feature only
      call `setLngLat`, and call `setHTML` only when the feature changes.

- [ ] **The planner runs a fraction query it already has.**
      `routePathFinder.ts:878-898`, `:959`. `locateStationsOnRoutes` recomputes
      what `findRoutesNearStations` returned in `stationMatches.fractions`.
      **Fix:** pass those through and delete the query.

- [ ] **The station proximity refresh rewrites every station row.**
      `src/lib/stationProximity.ts:49`. These are non-HOT updates (the column is
      in a partial-index predicate), leaving a dead tuple per station per import.
      **Fix:** add `WHERE s.near_route IS DISTINCT FROM (EXISTS …)`.

- [ ] (possible) **Station search is an unindexed scan.**
      `src/lib/routeQueries.ts:36-53`. `unaccent(name) ILIKE '%…%'` on every
      keystroke. Measure it; if it is slow, add a pg_trgm GIN index on an
      IMMUTABLE `unaccent` wrapper.

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

## Infra and deploy

- [ ] **Deploys don't apply schema or tile-function changes.**
      `.github/workflows/deploy.yml:50-63`. CI uploads `martin/` but never runs
      `02-vector-tiles.sql`, so a commit adding a tile function and its Martin
      entry deploys a config that references a function the DB does not have.
      Related problems in the same workflow: `martin:latest` is unpinned, secrets
      are interpolated into a single-quoted remote command line (a `'` in a
      password breaks it), and host keys are taken on trust via `ssh-keyscan`.
      **Fix:** a `psql -v ON_ERROR_STOP=1` migration step before `compose up`, a
      pinned Martin tag, and secrets read from an env file on the server.

- [ ] **Dependency tidying.** `package.json`.
      - `autoprefixer` and `postcss` are listed but unused (`postcss.config.mjs`
        only loads `@tailwindcss/postcss`).
      - `allowScripts` pins `sharp@0.34.5` while 0.35.4 is installed.
      - `npm audit` reports a low esbuild advisory (dev server on Windows):
        `npm audit fix`.

- [ ] (possible) **`pruneData` ignores `write()` backpressure.**
      `src/scripts/pruneData.ts:337-373`. Output buffers in memory when the disk
      is slower than osmium.

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
      The save-payload type is restated in `AdminPageClient.tsx:152-162`,
      `AdminSidebar.tsx:31-41` and `AdminCreateRouteTab.tsx:30-40`. **Fix:**
      `<RouteMetadataFields>`, `RouteMetadata`/`PathPreview` declared once in
      `types.ts`, and a `useRoutePreview` hook, which also fixes the missing
      try/catch and stale-response handling in `handlePreviewRoute` (`:133-178`).

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

- [ ] **Dead code in the admin pathfinder.** `railwayPathFinder.ts:176-224`:
      `searchDistance` and `maxAcceptable` are the same expression, so "Alternative
      is too long" can't run. `buildPathResult(firstPath)` merges a chain that
      its only caller throws away and rebuilds (`:733`).

- [ ] **Style values hard-coded outside `style.ts`.**
      - The dark ground `#05070a` is written twice in `basemap.ts` (`:204`,
        `:371`), and the two must match.
      - Railway-parts widths are inline at `src/lib/map/index.ts:437-446`.
      - Default route and click widths (3 and 16) are inline at `index.ts:134`,
        `:171`, `:209`, `:248`, `:277`.
      - Line-class, scenic and frequency badge colours are inline in
        `tooltipFormatting.ts:167-192`.
      - There is also an empty duplicate "OPACITIES" banner in `style.ts`.

- [ ] **Remove dead exports and leftovers.**
      - The basemap and `mapState` re-export blocks in `src/lib/map/index.ts`
        (`:8-23`, `:550`); nothing imports them. Also `TILE_SERVER_PORT`'s
        export.
      - `getRegion` and `regionForCoordinate` (`regions.ts`). `getRegion` could
        instead replace the three `isRegionId(cookie) ? cookie : DEFAULT_REGION`
        copies in the pages.
      - `UserPreferences` (`types.ts:172`).
      - The unused `onRefreshMap` prop of `AdminCreateRouteTab`.
      - The `console.log` of whole payloads on every admin preview and save.

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

- [ ] **The admin colour expression breaks the paint-expression house rule.**
      `AdminMap.tsx:64-83` uses `["all", …]` inside a `case` that has further
      branches. That is harmless on GL JS, and the admin map is web-only, but
      CLAUDE.md says to keep every data-driven expression in the nested shape.
      Rewrite it, or note the exemption in CLAUDE.md.

## Docs

- [ ] **CLAUDE.md's station label sizes are stale.** CLAUDE.md says "size 10
      stepping to 11 at z16". `LABELS.station.size` in `src/lib/map/style.ts` is
      13/14.

## Possible, needs checking

- [ ] `CountriesStatsTab.tsx:29-43` reloads `getProgressByCountry()` on every
      checkbox toggle, although the result doesn't depend on the selection.
- [ ] `localStorage.ts:55-56`, `:218-219` parse inside try/catch but don't check
      the shape. A stored `{"journeys":{}}` would crash `.filter` in the tabs.
- [ ] `loadBasemapStyle` shares its memoised layer *objects* across every map
      instance (`useMapLibre` spreads the array, not the objects). If MapLibre
      mutates specs in place, state leaks between the admin and user maps.
