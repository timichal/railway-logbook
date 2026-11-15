# TODO

Performance audit, 2026-11-14. Nothing here may lower geometry precision (no coarser coordinates, no extra simplification): the map must stay exact. Numbers marked _measured_ were taken on the local dev database (7,332 routes, 66k stations, 1.5M parts). The rest are estimates, so measure before and after each one.

**Where to measure.** The server is small (2 vCPU / 4GB, see `osmium-scripts/CLAUDE.md`). The dev machine has plenty of cores and disk, so pipeline measurements (prepare timings, extract sizes, changed-part counts, recalculation runs) go there, against the local Docker database and a local `data/` copy. Only sizing decisions (memory, `shared_buffers`, concurrency) need re-checking against the server's limits.

## Cache the route tiles: what is left

The web user maps cache their route tiles since 2026-11-15: `railway_routes_tile_versioned` under `v=<routesTileVersion>`, served `immutable` and held in Martin's memory cache (128MB, `martin/configuration.yml`). See "Vector tiles" in CLAUDE.md. Left:

- **Measure it on the server** after a week: `pg_stat_statements` calls and mean time of `railway_routes_tile` against the week before (the reload of a page used to run every tile's SQL again, because a 304 still computes the tile), and the `tiles` container's memory (`docker stats`) against the 128MB cache. Resize `cache.size_mb` from that.
- **Scenic lines and public notes**, if their tiles show up in `pg_stat_statements`: a `data_versions` row and a `bump_data_version` trigger for each table (a migration script, since `01-schema.sql` isn't re-run), then a versioned source each, as for the routes.

## Pipeline and deploy

Measure these on the dev machine (see the top). **Judge each against "Where a deploy's time goes" in `RECALC_PERFORMANCE.md`** (measured 2026-11-15): prepare's step 1 is ~80% of a deploy (~97 of ~120 min on the server, 20m 40s locally), most of it `pyosmium-up-to-date` rewriting whole files; the recalculation is ~11%; merge, export and prune together under a minute locally.

To measure step 1 locally, copy the server's raw cache into `data/raw` (plink `cat` per file, 6 at a time: ~1h for 35 GiB at ~10 MB/s; one stream caps at ~4 MB/s) and run `prepareMapData` with `RAW_CACHE=data/raw` and `pyosmium-up-to-date` on the PATH (`pip install osmium` into a venv works on Windows). Geofabrik itself throttles to 2–3 MB/s. The 2026-11-15 run's update deleted each raw file after updating it (fixed since, see `updatable_raw`), so `data/raw` is empty again.

- **Single-pass update and filter.** The timings say prepare dominates: `pyosmium-up-to-date` took 15m 54s of step 1's 20m 40s locally (France 2m 0s, Germany 1m 45s), `tags-filter` 3m 58s. Each cached extract is rewritten in full, then read twice by `tags-filter` (once to collect referenced nodes): about 70GB of decompression for the 35GB of extracts, on the server's slow volume.
  - A small libosmium (C++) or Rust tool could apply the diff and filter in one pass, taking the needed node ids from the previous rail file plus the diff.
  - A cheaper variant: rewrite the raw file only every N deploys and stream `apply-changes` the rest of the time, capping the backlog because osmium holds the changes in memory.
  - Also try overlapping the next extract's update with the current filter (they mostly touch different disks on the server), minding the disk-budget logic in `osmium-scripts/CLAUDE.md`.
- **Import only what changed, then recalculate only what it could affect.** Needs care, and the recalculation it would skip is ~11% of a deploy (12 of ~120 min on the server); the load it would shrink is part of the ~9 min after step 1.
  - Step 1: COPY the new parts into a temp table, DELETE only vanished or changed rows (compare `geometry::bytea` and the attributes the pathfinder and tiles read), INSERT only new and changed ones. Still one transaction, still only ROW EXCLUSIVE locks. Record the changed part ids with old and new geometry.
  - Step 2: a route can skip recalculation when all three hold:
    - no changed part (old or new geometry) lies within its first-pass 50km load;
    - none of those parts has a different route set in `partRoutes` (persist the previous snapshot and compare);
    - its last run found the path on the first (50km) pass (persist which pass succeeded).
  - Prove it with the md5-of-geometry regression check in `RECALC_PERFORMANCE.md`.
  - **Measure the payoff first** on the dev machine: diff two consecutive weekly extracts' parts and count how many routes' 50km disks contain a change. If most do, stop at step 1. (One day's diffs, 2026-11-13 to 14, changed 15 of 2552 recalculated routes' geometry.)
  - The changed-part diff also gives a cheap "nothing changed" answer for `deployMapData`.
- **Hold the whole part network in memory for recalculation.** `partNetwork.ts` asks Postgres for `ST_AsGeoJSON(geometry)` of every part within 50km of each route, `JSON.parse`s it, and rebuilds keys, lengths and adjacency in `add()`, for every route. `runPool` runs its workers as async tasks in one Node process, so all parsing and searching share one JS thread, busy 72% of the run at 4 workers. Ceiling: the parse (75s summed) and most of the part queries (278s summed, overlapping) of a 2m 13s run locally; on the server, part of its 12 minutes.
  - Proposal: load every part once, through the same `ST_AsGeoJSON` text so the coordinates are bit-identical, and build the endpoint-key → parts map once.
  - Per route, run the same `ST_DWithin … ORDER BY id` query but `SELECT id` only, so Postgres still decides which parts load and in what order.
  - `connected()` becomes the global sorted neighbour list filtered to the loaded set, in the same order.
  - This is the "still on the table" shared-cache item, taken further.
  - Verify with the PathResult JSON comparison over **all** routes described in `RECALC_PERFORMANCE.md` "Regression check".
  - Watch memory: estimate 0.3–1GB for 1.5M parts. Measure on the dev machine and check it fits the server next to Postgres (now `shared_buffers=1GB`) and `importMapData`'s `--max-old-space-size=8192`, which on a 4GB host means swapping before an out-of-memory error.
  - Read `RECALC_PERFORMANCE.md` in full first: don't shrink the buffer ladder, and don't wrap the run in a transaction.
- **`VACUUM (ANALYZE) railway_parts, stations` after the import commits, before recalculation.** The DELETE + reinsert in one transaction leaves the table and its indexes (PK, both GISTs, the long-parts partial GIST) at twice their size. Nothing vacuums them, so recalculation's index scans wade through dead entries while autovacuum competes for I/O. The part queries are the recalculation's largest cost (278s summed locally).
  - `VACUUM` can't run inside a transaction: run it on the pool after `loadStationsAndParts` returns.
  - It takes no lock that blocks tile reads.
- **Insert `railway_parts` in spatial order.** Rows go in in file order (OSM id order), so a 50km load or a tile reads roughly one heap page per part.
  - In `loadRailwayData.ts`, load into a temp table first, then `INSERT … SELECT … ORDER BY ST_GeoHash(ST_Centroid(geometry))` (or a Hilbert key), inside the same all-or-nothing transaction.
  - Queries keep their `ORDER BY id`, so results don't change.
  - Measure `verifyRouteData` and a few parts tiles before and after.
- **Fold the length query into the recalculation `UPDATE`** (`verifyRouteData.ts`, the first "still on the table" item in `RECALC_PERFORMANCE.md`). The length query and the UPDATE together came to 156s summed over 4 workers locally (61ms a route, queueing included), so this is worth tens of seconds at most: do it only while working there anyway.
- **Trim the GeoJSON export to the tags `pruneData` reads, and pipe the intermediate steps** (`merge -H | time-filter`, `export | pruneData`). Merge, export and prune took 51s together locally, so these are worth little; do them only alongside other work in `prepare.sh`.
  - Tags: give `osmium export` a `--config` with `include_tags` limited to what `pruneData.ts` and the import actually read (`name`, `railway`, `usage`, `highspeed`, `subway`, `name:ja_rm`, `name:ja-Latn`, `name:en`, and anything else they read; grep for them). Compare `data/pruned.geojson` byte for byte before and after: it must be identical.
  - Piping `export | pruneData` gives up resuming at that step.

## Ongoing

- **Read `pg_stat_statements` on the server** after a week of real traffic (enabled 2026-11-14: preloaded by the `db` service's `command:`, the extension created in `02-vector-tiles.sql`), and add what it shows to this list.
