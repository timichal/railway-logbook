# TODO

Performance audit, 2026-11-14. Nothing here may lower geometry precision (no coarser coordinates, no extra simplification): the map must stay exact. Numbers marked _measured_ were taken on the local dev database (7,332 routes, 66k stations, 1.5M parts). The rest are estimates, so measure before and after each one.

**Where to measure.** The server is small (2 vCPU / 4GB, see `osmium-scripts/CLAUDE.md`). The dev machine has plenty of cores and disk, so pipeline measurements (prepare timings, extract sizes, changed-part counts, recalculation runs) go there, against the local Docker database and a local `data/` copy. Only sizing decisions (memory, `shared_buffers`, concurrency) need re-checking against the server's limits.

## Cache the route tiles: what is left

The web user maps cache their route tiles since 2026-11-15: `railway_routes_tile_versioned` under `v=<routesTileVersion>`, served `immutable` and held in Martin's memory cache (128MB, `martin/configuration.yml`). See "Vector tiles" in CLAUDE.md. Left:

- **Measure it on the server** after a week: `pg_stat_statements` calls and mean time of `railway_routes_tile` against the week before (the reload of a page used to run every tile's SQL again, because a 304 still computes the tile), and the `tiles` container's memory (`docker stats`) against the 128MB cache. Resize `cache.size_mb` from that.
- **Scenic lines and public notes**, if their tiles show up in `pg_stat_statements`: a `data_versions` row and a `bump_data_version` trigger for each table (a migration script, since `01-schema.sql` isn't re-run), then a versioned source each, as for the routes.

## Pipeline and deploy

Measure these on the dev machine (see the top). **Judge each against "Where a deploy's time goes" in `RECALC_PERFORMANCE.md`** (measured 2026-11-15): prepare's step 1 was ~80% of a deploy (~97 of ~120 min on the server, 20m 40s locally), most of it `pyosmium-up-to-date` rewriting whole files, which it no longer does (see the end of that section); the recalculation is ~11%; merge, export and prune together under a minute locally.

To measure step 1 locally: Geofabrik still serves older dated files (`europe/france-261108.osm.pbf`), so a raw file a week behind plus `pyosmium-get-changes` gives a realistic backlog without the server's cache. Run osmium in an `ubuntu:26.04` container with apt `osmium-tool pyosmium` (the server's exact versions), on a Docker volume rather than a Windows bind mount, which is several times slower to read. Geofabrik throttles to 2–3 MB/s.

- **Hold the whole part network in memory for recalculation.** `partNetwork.ts` asks Postgres for `ST_AsGeoJSON(geometry)` of every part within 50km of each route, `JSON.parse`s it, and rebuilds keys, lengths and adjacency in `add()`, for every route. `runPool` runs its workers as async tasks in one Node process, so all parsing and searching share one JS thread, busy 72% of the run at 4 workers. Ceiling: the parse (75s summed) and most of the part queries (278s summed, overlapping) of a 2m 13s run locally; on the server, part of its 12 minutes.
  - Proposal: load every part once, through the same `ST_AsGeoJSON` text so the coordinates are bit-identical, and build the endpoint-key → parts map once.
  - Per route, run the same `ST_DWithin … ORDER BY id` query but `SELECT id` only, so Postgres still decides which parts load and in what order.
  - `connected()` becomes the global sorted neighbour list filtered to the loaded set, in the same order.
  - This is the "still on the table" shared-cache item, taken further.
  - Verify with the PathResult JSON comparison over **all** routes described in `RECALC_PERFORMANCE.md` "Regression check".
  - Watch memory: estimate 0.3–1GB for 1.5M parts. Measure on the dev machine and check it fits the server next to Postgres (now `shared_buffers=1GB`) and `importMapData`'s `--max-old-space-size=8192`, which on a 4GB host means swapping before an out-of-memory error.
  - Read `RECALC_PERFORMANCE.md` in full first: don't shrink the buffer ladder, and don't wrap the run in a transaction.
- **Reorder `railway_parts` spatially, once.** Rows sit in the order they were first imported (file order, OSM id order), so a 50km load or a tile reads roughly one heap page per part. Since 2026-11-16 the import writes only the parts that changed (`applyStagedParts`), so the heap keeps whatever order it has: one reorder now holds, decaying only by the few parts each deploy moves or adds.
  - A migration script that rewrites the table in `ST_GeoHash(ST_Centroid(geometry))` (or Hilbert) order without `CLUSTER`/`VACUUM FULL`, which take ACCESS EXCLUSIVE and would block every tile query for the length of the rewrite: e.g. in one transaction, stage the rows ordered, DELETE all and INSERT them back in that order, then `VACUUM (ANALYZE)` outside it. Run it on the server between deploys, never during one.
  - Queries keep their `ORDER BY id`, so results don't change.
  - Measure `verifyRouteData` and a few parts tiles before and after, on the dev machine first. Drop the item if the gain is small.
- **Fold the length query into the recalculation `UPDATE`** (`verifyRouteData.ts`, the first "still on the table" item in `RECALC_PERFORMANCE.md`). The length query and the UPDATE together came to 156s summed over 4 workers locally (61ms a route, queueing included), so this is worth tens of seconds at most: do it only while working there anyway.
- **Trim the GeoJSON export to the tags `pruneData` reads, and pipe the intermediate steps** (`merge -H | time-filter`, `export | pruneData`). Merge, export and prune took 51s together locally, so these are worth little; do them only alongside other work in `prepare.sh`.
  - Tags: give `osmium export` a `--config` with `include_tags` limited to what `pruneData.ts` and the import actually read (`name`, `railway`, `usage`, `highspeed`, `subway`, `name:ja_rm`, `name:ja-Latn`, `name:en`, and anything else they read; grep for them). Compare `data/pruned.geojson` byte for byte before and after: it must be identical.
  - Piping `export | pruneData` gives up resuming at that step.

## Ongoing

- **Check step 1 of the next map deploy** (`deployMapData`, then `--follow` or `data/deploy.log`): the raw cache is no longer rewritten on each update (2026-11-15, see "Raw cache" in `osmium-scripts/CLAUDE.md`). Its first run fetches up to a day or two of diffs per extract and refilters; compare `[1/4] took` against ~97 min, and add the figure to `RECALC_PERFORMANCE.md` "Where a deploy's time goes". The first run after `REBASE_AFTER_DAYS` (35) rebases nearly every extract at once (they were all last rewritten 2026-11-13/14), about the old cost: if that one hurts, stagger the rebases (e.g. by the extract's place in the list).
- **Read `pg_stat_statements` on the server** after a week of real traffic (enabled 2026-11-14: preloaded by the `db` service's `command:`, the extension created in `02-vector-tiles.sql`), and add what it shows to this list.
