# TODO

Performance audit, 2026-11-14. Nothing here may lower geometry precision (no coarser coordinates, no extra simplification): the map must stay exact. Numbers marked _measured_ were taken on the local dev database (7,332 routes, 66k stations, 1.5M parts). The rest are estimates, so measure before and after each one.

**Where to measure.** The server is small (2 vCPU / 4GB, see `osmium-scripts/CLAUDE.md`). The dev machine has plenty of cores and disk, so pipeline measurements (prepare timings, extract sizes, changed-part counts, recalculation runs) go there, against the local Docker database and a local `data/` copy. Only sizing decisions (memory, `shared_buffers`, concurrency) need re-checking against the server's limits.

## Cache the route tiles: what is left

The web user maps cache their route tiles since 2026-11-15: `railway_routes_tile_versioned` under `v=<routesTileVersion>`, served `immutable` and held in Martin's memory cache (128MB, `martin/configuration.yml`). See "Vector tiles" in CLAUDE.md. Left:

- **Measure it on the server** after a week: `pg_stat_statements` calls and mean time of `railway_routes_tile` against the week before (the reload of a page used to run every tile's SQL again, because a 304 still computes the tile), and the `tiles` container's memory (`docker stats`) against the 128MB cache. Resize `cache.size_mb` from that.
- **Scenic lines and public notes**, if their tiles show up in `pg_stat_statements`: a `data_versions` row and a `bump_data_version` trigger for each table (a migration script, since `01-schema.sql` isn't re-run), then a versioned source each, as for the routes.

## Ongoing

- **See what the spatial reorder of `railway_parts` did on the server** (`reorderRailwayParts`, run there 2026-11-16; locally it cut the heap pages a 50km load reads by 4×, see the script's header). At the next map deploy, compare the import's recalculation (`=== Step 2`, its "part queries" sum and the part catalog's load time) against the deploy before; with the `pg_stat_statements` read below, look at `railway_parts_tile`. If either moved noticeably, add the figure to `RECALC_PERFORMANCE.md` "Where a deploy's time goes". The swap gave the table a new OID, so its queries started over under new `pg_stat_statements` entries.
- **Check step 1 of the next map deploy** (`deployMapData`, then `--follow` or `data/deploy.log`): the raw cache is no longer rewritten on each update (2026-11-15, see "Raw cache" in `osmium-scripts/CLAUDE.md`). Its first run fetches up to a day or two of diffs per extract and refilters; compare `[1/3] took` (`[1/4]` before 2026-11-16) against ~97 min, and add the figure to `RECALC_PERFORMANCE.md` "Where a deploy's time goes". The first run after `REBASE_AFTER_DAYS` (35) rebases nearly every extract at once (they were all last rewritten 2026-11-13/14), about the old cost: if that one hurts, stagger the rebases (e.g. by the extract's place in the list).
- **Read `pg_stat_statements` on the server** after a week of real traffic (enabled 2026-11-14: preloaded by the `db` service's `command:`, the extension created in `02-vector-tiles.sql`), and add what it shows to this list.
