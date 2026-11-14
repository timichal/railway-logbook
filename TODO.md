# TODO

Performance audit, 2026-11-14. Nothing here may lower geometry precision (no coarser coordinates, no extra simplification): the map must stay exact. Numbers marked _measured_ were taken on the local dev database (7,332 routes, 66k stations, 1.5M parts). The rest are estimates, so measure before and after each one.

**Where to measure.** The server is small (2 vCPU / 4GB, see `osmium-scripts/CLAUDE.md`). The dev machine has plenty of cores and disk, so pipeline measurements (prepare timings, extract sizes, changed-part counts, recalculation runs) go there, against the local Docker database and a local `data/` copy. Only sizing decisions (memory, `shared_buffers`, concurrency) need re-checking against the server's limits.

## Quick wins

- **Small sequential round trips** (a few ms each; do them while you're in each file):
  - `journeyWithBoundsForUser` and `tripWithBoundsForUser` compute bounds after the main query.
  - `planJourney` runs `planBounds` after the details; `ST_Extent` could go into `getRouteDetails`.
  - The public map resolves the share token in its own query before reading progress.
  - `page.tsx` does `getUser`, then preferences (now two queries, was three): one query could do both.

## Medium

- **Drop the text attributes from low-zoom route tiles.** `railway_routes_mvt` (`database/init/02-vector-tiles.sql`) puts `name`, `other_names`, `from_station`, `to_station`, `description`, `usage_tags`, `link`, `link_name`, `journey_name` and so on into every tile at every zoom. Measured at z4 (tile 4/8/5), the same rows:

  | What's in the tile                                                                                                                         | Size  | Time  |
  | ------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----- |
  | Everything, as today                                                                                                                       | 536KB | 213ms |
  | Geometry + styling and filtering attributes only (`track_id`, `usage_type`, `line_class`, countries, `is_valid`, `under_repair`, `closed`) | 228KB | 56ms  |
  | Geometry + `track_id`                                                                                                                      | 140KB | 59ms  |
  - Options:
    - Emit the text only from some zoom up (z8?).
    - Never emit it, and have popups and hover fetch a route's details by id. One cached JSON per region, or a small lookup endpoint.
  - First list every reader of each property, on the web (popups, `routeFeature.ts`, `routeTitle`, the highlight code) and in `mobile/`. The hover popup at low zoom needs the names right away, so fetching on demand needs a cache or a prefetch.
  - Keep the `ORDER BY` and `track_id` as the feature id.
  - Check the admin map too: it reads the same Martin source (`railway_routes_tile`).
- **Move read-only calls off server actions.** Next runs a client's server actions one at a time (`node_modules/next/dist/docs/01-app/02-guides/backend-for-frontend.md`, "Server Actions are queued"). So on a signed-in load `getTripNames` → `getUserProgress` → `getCoveredStretches` run in sequence, a slow `findRoutePathBetweenStations` holds up station search and progress, and the admin page queues four or more loads.
  - Serve the reads from GET route handlers that resolve the session the way `src/lib/api/tiles.ts` does and call the existing `*Queries.ts` functions. Keep writes as server actions.
  - Rules that apply ("Two transports" in the root CLAUDE.md): a route handler never imports a `"use server"` module; errors go through `errors.ts`; every handler checks the session itself.
  - Start with the load-time trio. The cheaper alternative is one combined "map init" action, which saves the queueing but not the caching.
- **Cache the route summaries for anonymous visitors.** `dataAccess.ts` calls `getRouteSummaries(region)` on mount: Europe is 5,956 rows, about 722KB of JSON, identical for everyone. It is a POST server action, so nothing caches it. Progress, colouring and stretches all wait on it, even with an empty local log.
  - Serve it from a public GET handler with an ETag, from the planner's network fingerprint or a routes-version counter (see the next item), plus `stale-while-revalidate`. `trackIdsInRegion` can go the same way.
  - With an empty local log, skip it: ask for the totals alone, and skip the coverage and status work.
  - The handler must stay user-independent.
- **Routes-version counter.** Several items here want a cheap "have the routes changed" value: the summaries ETag, a tile URL version, the planner cache. Today the planner fingerprints with `sum(xmin)`, which scans the 32MB `railway_routes` heap (~5–7ms).
  - Add a one-row table bumped by a statement-level trigger on `railway_routes` (and `scenic_lines`, `admin_notes` if the tiles use it). Put it in `02-vector-tiles.sql` idempotently, or in a migration.
- **Cache session route tiles in the browser.** `mvtResponse` (`src/lib/api/tiles.ts`) sends `private, no-store`, so panning back over an evicted area re-runs the per-user tile query. The URL's `v` is set once per page load (`useUserMap.ts`, `routesCacheBusterRef.current ??= Date.now()`) and bumped by `useSourceTileRefresh` on every refresh.
  - Before switching session tiles (`rides: "session"`) to `private, max-age=3600`, confirm that `v` changes on login, logout, a journey logged, a country change and a region switch.
  - Keep `no-store` for `?share=` tiles, so turning sharing off still stops a map that is already open.
  - The native app (`mobile/src/map/tileAuth.ts`) also requests these tiles. Check how it builds `v`.
  - Superseded by "Route tiles identical for everyone" below, if that is done.
- **Country filter on the client.** `selected_countries` is in the route tile URL (`useUserMap.ts`), so ticking a country refetches every route tile in view. The tile already carries `start_country` / `end_country`, and scenic lines and the coverage layers already filter by country on the client (`scenicLinesFilter`).
  - Fold an `in` filter into `routeLineFilter` and the click buffer filter, and keep the tile URL stable. The anonymous map's Martin URL then becomes the same for every visitor, which also helps caching.
  - Trade-offs: bigger tiles for someone with few countries ticked. Highlights ignore layer filters, so a planner or trip highlight would now show routes in unticked countries. Decide whether that's fine.
  - The native app shares `tileSources.ts`: keep the server-side parameter until both apps move.
  - Remember the "no `["all", …]` in data-driven paint" rule. It applies to paint, not filters, but check `src/lib/shared/map/CLAUDE.md`.
- **React Compiler.** Nothing in `src/components` is memoised, and a selection or highlight change re-renders `RailwayMap` → `UserSidebar` → the hidden Route Logger and planner.
  - Try `reactCompiler: true` (`node_modules/next/dist/docs`, `reactCompiler.md`) with `babel-plugin-react-compiler`.
  - Components that write refs during render (`RailwayMap.tsx`) are skipped by the compiler.
  - Profile with React DevTools before and after, and check the Biome `useExhaustiveDependencies` setup still makes sense.
- **Smaller bundle items:**
  - `MenuSheet` pulls the articles and auth forms (~30KB of source) into the main bundle: load them with `next/dynamic` when the sheet opens.
  - The sidebar waits for MapLibre because both sit in the `ssr:false` `RailwayMap` chunk. Loading `maplibre-gl` with `await import()` inside `useMapLibre`'s init would let the sidebar render first. `mapHover`, `userMapInteractions` and `fitCamera` would then need type-only imports or the module passed in.

## Big: route tiles identical for everyone

Measured at z7 (7/69/43): a signed-in route tile takes 51ms, an anonymous one 19ms. About 30ms of every tile on every pan goes on working out the user's rides (`user_fully_ridden_routes` plus the latest-journey LATERAL). The anonymous map already colours routes by feature state (`useLocalRouteFeatureStates`) and keeps closed routes it rode by id (`closedRoutesFilter`).

- **Proposal:**
  - Signed-in and shared maps fetch their ride status once: track_id → latest date, journey name, partial, ridden whole.
  - They apply it as feature state, as the anonymous map does.
  - Every route tile then comes from Martin and is the same for everyone.
  - With a routes-version in the tile URL (see above), tiles can be `Cache-Control: public, immutable`, cacheable by browsers, Caddy or a CDN. Martin's `cache_size_mb` could then go above 0 too.
- **What must still hold** (root CLAUDE.md "Vector tiles and sharing"):
  - A dead session or a dead share link must still blank the map rather than draw it unridden. That rule moves to the ride-status endpoint, which must re-resolve the share token on every call.
  - The "latest journey" styling and hover data must come out identical.
  - The native app draws the same tiles and must move in step.
  - `railway_routes_mvt` stays out of Martin.
- **Measure first:** the size of the status JSON for the heaviest user, and how long applying feature state takes for a few thousand routes.

## Pipeline and deploy

Measure these on the dev machine (see the top).

- **Time each step first.** Nothing records step durations except verifyRouteData's total.
  - Print timestamps around each `[n/4]` step and each update and filter in `osmium-scripts/prepare.sh`, and around the three steps of `importMapData`.
  - In recalculation, total the time in `PartNetwork.loadAround` separately from the search.
  - Run a full prepare + import + verify on the dev machine and write the split into `RECALC_PERFORMANCE.md`. Every item below should be judged against it.
- **Hold the whole part network in memory for recalculation.** `partNetwork.ts` asks Postgres for `ST_AsGeoJSON(geometry)` of every part within 50km of each route, `JSON.parse`s it, and rebuilds keys, lengths and adjacency in `add()`, for every route. `runPool` runs its workers as async tasks in one Node process, so all parsing and searching share one JS thread. That is why scaling flattens after 2 workers (`RECALC_PERFORMANCE.md`).
  - Proposal: load every part once, through the same `ST_AsGeoJSON` text so the coordinates are bit-identical, and build the endpoint-key → parts map once.
  - Per route, run the same `ST_DWithin … ORDER BY id` query but `SELECT id` only, so Postgres still decides which parts load and in what order.
  - `connected()` becomes the global sorted neighbour list filtered to the loaded set, in the same order.
  - This is the "still on the table" shared-cache item, taken further.
  - Verify with the PathResult JSON comparison over **all** routes described in `RECALC_PERFORMANCE.md` "Regression check".
  - Watch memory: estimate 0.3–1GB for 1.5M parts. Measure on the dev machine and check it fits the server next to Postgres (now `shared_buffers=1GB`) and `importMapData`'s `--max-old-space-size=8192`, which on a 4GB host means swapping before an out-of-memory error.
  - Read `RECALC_PERFORMANCE.md` in full first: don't shrink the buffer ladder, and don't wrap the run in a transaction.
- **Insert `railway_parts` in spatial order.** Rows go in in file order (OSM id order), so a 50km load or a tile reads roughly one heap page per part.
  - In `loadRailwayData.ts`, load into a temp table first, then `INSERT … SELECT … ORDER BY ST_GeoHash(ST_Centroid(geometry))` (or a Hilbert key), inside the same all-or-nothing transaction.
  - Queries keep their `ORDER BY id`, so results don't change.
  - Measure `verifyRouteData` and a few parts tiles before and after.
- **`VACUUM (ANALYZE) railway_parts, stations` after the import commits, before recalculation.** The DELETE + reinsert in one transaction leaves the table and its indexes (PK, both GISTs, the long-parts partial GIST) at twice their size. Nothing vacuums them, so recalculation's index scans wade through dead entries while autovacuum competes for I/O.
  - `VACUUM` can't run inside a transaction: run it on the pool after `loadStationsAndParts` returns.
  - It takes no lock that blocks tile reads.
- **Trim the GeoJSON export to the tags `pruneData` reads.** Give `osmium export` a `--config` with `include_tags` (or an attributes and tags filter) limited to what `pruneData.ts` and the import actually read: `name`, `railway`, `usage`, `highspeed`, `subway`, `name:ja_rm`, `name:ja-Latn`, `name:en`, and anything else they read (grep for them).
  - Compare `data/pruned.geojson` byte for byte before and after on the dev machine. It must be identical.
- **Pipe intermediate steps in `prepare.sh`.** `merge -H | time-filter`, and `export | pruneData`, which gives up resuming at that step. Also try overlapping the next extract's update with the current filter, since they mostly touch different disks.
  - Mind the disk-budget logic described in `osmium-scripts/CLAUDE.md` before changing what runs concurrently.
- **Import only what changed, then recalculate only what it could affect.** The potentially biggest win; needs care.
  - Step 1: COPY the new parts into a temp table, DELETE only vanished or changed rows (compare `geometry::bytea` and the attributes the pathfinder and tiles read), INSERT only new and changed ones. Still one transaction, still only ROW EXCLUSIVE locks. Record the changed part ids with old and new geometry.
  - Step 2: a route can skip recalculation when all three hold:
    - no changed part (old or new geometry) lies within its first-pass 50km load;
    - none of those parts has a different route set in `partRoutes` (persist the previous snapshot and compare);
    - its last run found the path on the first (50km) pass (persist which pass succeeded).
  - Prove it with the md5-of-geometry regression check in `RECALC_PERFORMANCE.md`.
  - **Measure the payoff first** on the dev machine: diff two consecutive weekly extracts' parts and count how many routes' 50km disks contain a change. If most do, stop at step 1.
  - The changed-part diff also gives a cheap "nothing changed" answer for `deployMapData`.
- **Single-pass update and filter (only if the timings say prepare dominates).** Each cached extract is rewritten in full by `pyosmium-up-to-date`, then read twice by `tags-filter` (once to collect referenced nodes): about 70GB of decompression for the 35GB of extracts, on the server's slow volume.
  - A small libosmium (C++) or Rust tool could apply the diff and filter in one pass, taking the needed node ids from the previous rail file plus the diff.
  - A cheaper variant: rewrite the raw file only every N deploys and stream `apply-changes` the rest of the time, capping the backlog because osmium holds the changes in memory.
- **Fold the length query into the recalculation `UPDATE`** (`verifyRouteData.ts`, the first "still on the table" item in `RECALC_PERFORMANCE.md`). Worth seconds, not minutes: do it only while working there anyway.

## Ongoing

- **Read `pg_stat_statements` on the server** after a week of real traffic (enabled 2026-11-14: preloaded by the `db` service's `command:`, the extension created in `02-vector-tiles.sql`), and add what it shows to this list.
