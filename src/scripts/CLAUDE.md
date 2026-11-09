# Scripts

The commands are listed in the root CLAUDE.md. Read `RECALC_PERFORMANCE.md` before touching `verifyRouteData.ts`, `lib/railwayPathFinder.ts`, `lib/partNetwork.ts` or `lib/partGeometry.ts` for performance. Don't shrink the pathfinder's buffer, don't wrap the run in a transaction, and don't silence the pathfinder from outside. `PATHFINDER_CAVEATS.md` lists the pathfinder's known limits and what to do if a route runs into one.

## Migrations

Schema changes and data transforms are a TS script here: import `pool` from `../lib/db`, run SQL, log progress, exit. Reference: `markAllRoutesInvalid.ts`. Register it in `package.json` and add it to "Data pipeline and database" in the root CLAUDE.md's commands. `01-schema.sql` gets the change too, for new databases.

## Route pathfinding (`lib/railwayPathFinder.ts`, over `partNetwork.ts` + `partGeometry.ts`, pure)

- The click points are matched to railway parts at 1m tolerance. The edge parts are truncated to them and the chain is stitched by `mergeLinearChain` (its rule is in the root CLAUDE.md).
- Dijkstra by length (it was a BFS by part count, which took a long way round of few ways over a short line of many). When the shortest path backtracks, a second search runs that refuses reversals: it keys on (part, end entered at), leaves a part only through its other end, and refuses a turn over `BACKTRACKING_THRESHOLD_DEGREES` (`turnDegrees`). Its path wins however much longer it is; the backtracking one is kept only when nothing else connects.
- **A route keeps off track other routes run along** (`avoidOtherRoutes`): such a part costs ×1.5 (`TAKEN_PART_WEIGHT`), unless the route being searched runs along it too (a duplicate being split, a stretch shared on purpose). Scenic lines never do. Which routes run along which part is `partRoutes.ts`: the part's midpoint within ~1.5m of the route. A bulk run (`verifyRouteData`) takes it **once, network-wide, before it starts** (26–41s), so every route sees the others as they stood then, whatever order the workers take them in. A single search (the admin preview, `showBacktracking`) loads it for its own area (~250ms). The preview passes the id of the route being re-picked (`AdminPathFor`).
- `verifyRouteData` recalculates the valid routes, then the valid scenic lines. It never touches an **invalid** route (the admin resolves those by hand) or a **closed** one, whose geometry is frozen (both in "Routes" in the root CLAUDE.md). Its writes are conditional on the line still being valid (and a route open), so one the admin closed or marked invalid mid-run is left be. A mid-run re-pick of a route that stays valid is not caught.

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
