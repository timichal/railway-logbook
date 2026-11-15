# TODO

Performance audit, 2026-11-14. Nothing here may lower geometry precision (no coarser coordinates, no extra simplification): the map must stay exact. Numbers marked _measured_ were taken on the local dev database (7,332 routes, 66k stations, 1.5M parts). The rest are estimates, so measure before and after each one.

**Where to measure.** The server is small (2 vCPU / 4GB, see `osmium-scripts/CLAUDE.md`). The dev machine has plenty of cores and disk, so pipeline measurements (prepare timings, extract sizes, changed-part counts, recalculation runs) go there, against the local Docker database and a local `data/` copy. Only sizing decisions (memory, `shared_buffers`, concurrency) need re-checking against the server's limits.

## Cache the route tiles

The route tile is Martin's and the same for everyone since 2026-11-15 (the rides come as a list, `src/lib/shared/map/routeRides.ts`), so it can be cached. It isn't yet: Martin answers with an ETag and no `Cache-Control`, and runs with `cache_size_mb: 0` (`martin/configuration.yml`).

- **Proposal:**
  - Put the routes version in the route tile URL (`routesFingerprint`, the `data_versions` counter), so a changed route is a new URL. The web page needs it at first paint (from the server render, beside the region), and the native app from the API.
  - Serve tiles that carry it with `Cache-Control: public, max-age=31536000, immutable` (Caddy, on `/tiles/railway_routes_tile/*` with a `v`), cacheable by browsers, Caddy or a CDN. Raise Martin's `cache_size_mb` above 0, sized against the 4GB server.
  - Add `data_versions` rows and triggers for `scenic_lines` and `admin_notes` if their tiles want the same.
- **What must still hold:** an admin's route save shows on the user map at the next page load at the latest; the admin map keeps refetching its own tiles after a save (`useSourceTileRefresh`).
- **Measure first:** how often a page load refetches tiles it already fetched (browser devtools, a few pans and a reload), and Martin's tile times on the server from `pg_stat_statements`.

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
