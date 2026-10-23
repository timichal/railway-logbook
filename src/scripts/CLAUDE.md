# Scripts

The commands are listed in the root CLAUDE.md. Read `RECALC_PERFORMANCE.md` before touching `verifyRouteData.ts`, `lib/railwayPathFinder.ts`, `lib/partNetwork.ts` or `lib/partGeometry.ts` for performance. Don't shrink the pathfinder's buffer, don't wrap the run in a transaction, and don't silence the pathfinder from outside.

## Migrations

Schema changes and data transforms are a TS script here: import `pool` from `../lib/db`, run SQL, log progress, exit. Reference: `markAllRoutesInvalid.ts`. Register it in `package.json` and add it to "Data pipeline and database" in the root CLAUDE.md's commands. `01-schema.sql` gets the change too, for new databases.

## Route pathfinding (`lib/railwayPathFinder.ts`, over `partNetwork.ts` + `partGeometry.ts`, pure)

- The click points are matched to railway parts at 1m tolerance. The edge parts are truncated to them and the chain is stitched by `mergeLinearChain` (its rule is in the root CLAUDE.md).
- BFS by hop count. A distance-weighted search runs only when the shortest path backtracks. That search keys on (part, end entered at) and rejects a part entered and left through the same node.
- `verifyRouteData` recalculates routes, then scenic lines. For what a recalculation does to `under_repair`, see "Routes" in the root CLAUDE.md.

## Importing (`importMapData.ts`, `lib/loadRailwayData.ts`)

- **All-or-nothing** (`loadStationsAndParts`). Every file is validated first (present, non-empty, ending in `]}`), then the clear and reload run in one transaction. Use `DELETE`, not `TRUNCATE`, which would block every tile query for the length of the import.
- **GeoJSON is streamed** through `streamFeatures` (`lib/geojsonFeatureStream.ts`), which tracks string and escape state, because OSM tag values contain braces. Parse failures and truncated input are counted and raised, never skipped.
- Station names are resolved in `pruneData.ts`. CJK prefers `name:ja_rm`, `name:ja-Latn`, then `name:en`; Cyrillic/Greek are transliterated. Stations mapped as areas become their centroid under a **negated id** (node and way ids overlap). One is dropped when a same-name station node sits within 150m.

## Server data (`serverData.ts`)

- The server only runs `pg_dump` in its `db` container. The dump is streamed back over `plink -T` / `ssh -T` with no pty, because it is binary. **Route data** = `railway_routes`, `scenic_lines`, `admin_notes`, `users`, `user_preferences`, `user_trips`, `user_journeys`, `user_logged_parts` (everything not rebuilt from OSM). **Map data** = `stations` + `railway_parts`.
- A backup is written as `.part` and renamed only once `lib/pgDumpArchive.ts` has read it to the end and found exactly the expected tables. That way a backup needs only plink/ssh locally. It knows archive versions 1.14–1.16 (Postgres 12–18).
- `pullAllData` takes map and route data from **one** `pg_dump` (one snapshot, so the routes match the map beside them). The map is never pulled without the routes.
- A restore runs in the local `db` container in **one transaction** with `session_replication_role = replica`. `COMMIT` is sent only after `pg_restore` succeeds under `pipefail` (otherwise psql rolls back at EOF and exits 0). With FK checks off, every restore then unfiles any journey sitting in another user's trip, and stops listing any logged part whose user differs from its journey's. Restores refuse anything without the `PGDMP` header.
- Pulls refuse to start while a map data deploy is running (`remote-deploy.sh --state`); a backup only warns.

## Other

- `createAdmin`: no user is seeded and `users_id_seq` starts at 2, so id 1 stays reserved. `fixSequences` keeps `users`' floor at 2.
- Assets: `generateAppIcons.ts` (by hand, outputs committed; `apple-icon.png` on a white ground, since iOS fills transparency with black; the maskable icon fits the 80% safe circle). `copyMaplibreWorker.ts` runs on `predev`/`prebuild`.
