# TODO

Performance audit, 2026-11-14. Nothing here may lower geometry precision (no coarser coordinates, no extra simplification): the map must stay exact. Numbers marked _measured_ were taken on the local dev database (7,332 routes, 66k stations, 1.5M parts). The rest are estimates, so measure before and after each one.

**Where to measure.** The server is small (2 vCPU / 4GB, see `osmium-scripts/CLAUDE.md`). The dev machine has plenty of cores and disk, so pipeline measurements (prepare timings, extract sizes, changed-part counts, recalculation runs) go there, against the local Docker database and a local `data/` copy. Only sizing decisions (memory, `shared_buffers`, concurrency) need re-checking against the server's limits.

## Cache the route tiles: what is left

The web user maps cache their route tiles since 2026-11-15: `railway_routes_tile_versioned` under `v=<routesTileVersion>`, served `immutable` and held in Martin's memory cache (128MB, `martin/configuration.yml`). See "Vector tiles" in CLAUDE.md. Left:

- **Measure it on the server** after a week: `pg_stat_statements` calls and mean time of `railway_routes_tile` against the week before (the reload of a page used to run every tile's SQL again, because a 304 still computes the tile), and the `tiles` container's memory (`docker stats`) against the 128MB cache. Resize `cache.size_mb` from that.
- **Scenic lines and public notes**, if their tiles show up in `pg_stat_statements`: a `data_versions` row and a `bump_data_version` trigger for each table (a migration script, since `01-schema.sql` isn't re-run), then a versioned source each, as for the routes.

## Ongoing

- **The first map deploy from about 2026-12-18 rebases nearly every raw extract at once**: `REBASE_AFTER_DAYS` (35) runs out together for all of them, last rewritten 2026-11-13/14. That costs about what step 1 cost before the raw cache change (~97 min, against 12m 23s on 2026-11-16, `RECALC_PERFORMANCE.md`). If it hurts, stagger the rebases (e.g. by the extract's place in the list).
- **Read `pg_stat_statements` on the server** after a week of real traffic (enabled 2026-11-14: preloaded by the `db` service's `command:`, the extension created in `02-vector-tiles.sql`), and add what it shows to this list. The command, run on the server: `docker exec -i db sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB'` with the query on stdin. On 2026-11-16 `railway_parts_tile` was 16.8ms a tile with 6.8% of its buffers read from disk, but that entry mixes traffic from before and after `reorderRailwayParts` (its text doesn't name the table, so the reorder didn't start it over): judge it after the week, or after `SELECT pg_stat_statements_reset()`.
