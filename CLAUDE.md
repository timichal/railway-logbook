# CLAUDE.md

Guidance for Claude Code working in this repo. This file holds the commands, rules and gotchas; the reasoning behind each rule lives in the code comments of the file it points to — read those before changing the behaviour.

## Overview

Unified Next.js app for OSM railway data: fetches, processes and visualizes railway data for two regions — 21 European countries (`SUPPORTED_COUNTRIES` in `src/lib/shared/constants.ts`) and Japan (`REGIONS` in `src/lib/shared/regions.ts`). One database, one pipeline, one deploy; single `package.json`, `.env` and container. Data processing scripts live under `src/` beside the web app.

### `mobile/` is a second app

The React Native / Expo client (`MOBILE_APP_PLAN.md`), with its own `package.json` and `node_modules`. Everything else here describes the web app unless it says otherwise.

- **Separate TypeScript program.** The root `tsconfig.json` excludes `mobile/` (RN's global `setTimeout` breaks the web app's `Timeout` types), so root `npx tsc --noEmit` doesn't check it — `npm run typecheck` inside `mobile/` does.
- **Nested Biome config** (`mobile/biome.json`, `"root": false`): one root `npm run lint` covers both apps and applies the nested config under `mobile/`.
- **It imports `src/lib/shared/` as source**, as `@shared/*` (Metro `watchFolders`). A change there is a change to both apps. The HTTP API the two share is `API.md`.

### `src/lib/shared/` is the shared set

`regions.ts`, `constants.ts`, `types.ts`, `progress.ts`, `routeCoverage.ts`, `getUntimezonedDateStr.ts`, `countryFlag.ts`, `theme/types.ts`, and `map/` (see "Map library"). The web app imports it as `@/lib/shared/...`; inside the folder, imports are relative. Everything outside it is the web app's alone — notably `src/lib/map/index.ts`, which reads `window.location` at module load and would crash React Native.

**Biome enforces the boundary** (`overrides` in `biome.json`): a shared file may not import `pg`, `maplibre-gl` (take spec types from `@maplibre/maplibre-gl-style-spec`), `next`, `react-dom` or country-coder (subpaths included), nor any Node built-in; may not use `@/*` (it means a different `src` in each app); and may not climb out of the folder. The climb-out rule is written once per folder depth (`shared/*`, `shared/*/*`, `shared/*/*/*`) because a later override replaces rather than merges options — a file deeper than three levels needs a depth added. `mobile/biome.json` forbids relative imports into `src/lib` and `@shared/..`.

`@maplibre/maplibre-gl-style-spec` is a types-only dependency of the web app; `mobile/tsconfig.json` maps it to `mobile/node_modules` so the native program sees one copy (two copies' recursive `ExpressionSpecification` aren't assignable to each other).

## Core Commands

### Data pipeline
- `npm run prepareMapData -- [extract ...]` — download OSM, filter rail, merge, convert to GeoJSON, prune → `data/pruned.geojson`, plus `pruned.sources` (each extract's cut date). Extracts come from `osmium-scripts/extracts.txt` (Geofabrik paths; Europe one per country, since the continent won't fit the server's disk; Japan as one). All regions go into one file — a region is a bbox applied on read. Naming extracts (or a path prefix ending at `/`, e.g. `-- asia/japan`) builds `data/pruned-partial.geojson` instead; importing that still replaces the whole map.
  - Always each extract's latest (`-latest` resolved to the dated file it redirects to). The next download runs in the background while one is filtered, disk permitting.
  - Merged with `osmium merge -H` + `time-filter`: neighbouring extracts overlap and carry the same way in two versions, which a plain merge writes as two `railway_parts` rows with one id.
  - Europe's list mirrors Geofabrik's Europe page (combination regions, Iceland and the Azores aside; Russia as federal districts), so there is track everywhere on the admin map. A route crossing a region missing from the list goes invalid on import.
  - Filtered extracts are **kept** under `data/extracts/<geofabrik path>` beside a `.source` (dated file + `RAIL_FILTER`) and re-downloaded only when `-latest` points elsewhere or the filter changed. One removed from `extracts.txt` is deleted (unless `EXTRACTS_FILE` names a trial list); `--fresh` deletes them all. Details in `osmium-scripts/prepare.sh`.
- `npm run importMapData <filepath> [...]` — load GeoJSON into Postgres (stations + railway_parts). The tables are cleared once before the first file, so one run's files are the whole map. Recalculates existing routes (skipped on initial load); `--valid-only` only those not already invalid, `--concurrency=N` (default 4 — see `RECALC_PERFORMANCE.md`). All-or-nothing — see "Scripts".

### Database ops
- `docker-compose up -d db` — start Postgres+PostGIS.
- `npm run verifyRouteData` — recalculate all routes, then scenic lines; mark invalid ones. `--valid-only`, `--concurrency=N`.
- `npm run applyVectorTiles` — re-apply `database/init/02-vector-tiles.sql`.
- `npm run markAllRoutesInvalid` — flag all routes for recheck (then `verifyRouteData`). **Reference example for migration scripts.**
- `npm run fixSequences` — resync SERIAL sequences; fixes "duplicate key violates …_pkey" after rows were loaded with explicit ids some way other than `pullRouteData`/`restoreRouteData`. Keeps `users`' floor at 2.
- `npm run createAdmin -- <email> [name] [--reset]` — create the admin (user 1), prompting for the password (12+ chars, never an argument). **A setup step for every new database**: no user is seeded and `users_id_seq` starts at 2, so id 1 stays reserved. `--reset` replaces the admin's email and password (and name, if given) and signs out every admin web session and app login. On the server, run it from its checkout.
- `npm run listStations` — list unique station names (debug).
- `npm run inspectPath -- "<from>" "<to>" ["<via>"...] [--special]` — run the Journey Planner from the CLI (station names or ids; `--special` adds the non-Regular lines the region counts as ordinary) and print the chain, search time, partial legs and the gap between consecutive routes.
- `npm run showBacktracking` — list routes that backtrack unintentionally (`has_backtracking` without `intended_backtracking`), each with an OpenRailwayMap link at the turn and the id of the way it turns onto. Re-runs the search for those routes only; writes nothing. Not region-scoped. `--concurrency=N`.

### Server data (`src/scripts/serverData.ts`)
Run locally. The server only runs `pg_dump` in its `db` container, streamed back over `plink -T` / `ssh -T` (no pty — the dump is binary). **Route data** is everything not rebuilt from OSM: `railway_routes`, `scenic_lines`, `admin_notes`, `users`, `user_preferences`, `user_trips`, `user_journeys`, `user_logged_parts`. **Map data** is `stations` + `railway_parts`.
- `npm run backupRouteData` — route data into `data/backups/railway_data_<ISO timestamp>.dump` (custom format, zstd). Written as `.part` and renamed only once `scripts/lib/pgDumpArchive.ts` has read it to the end and found exactly the expected tables — so a backup needs only plink/ssh locally. Knows archive versions 1.14–1.16 (Postgres 12–18).
- `npm run pullRouteData` — a backup, then replaces the local route data with it and refreshes `near_route`. Local accounts become the server's, passwords included. Route geometry and validity were computed against the server's map — use `pullAllData` if the local map differs.
- `npm run pullAllData` — a backup, then map and route data from **one** `pg_dump` (one snapshot, so the routes match the map beside them), restored together (~450MB, not kept; ~1.5 min). The map is never pulled without the routes.
- `npm run restoreRouteData <file.dump>` — restore an earlier backup. Refuses anything without the `PGDMP` header.

A restore runs in the local `db` container in **one transaction** with `session_replication_role = replica`; `COMMIT` is sent only after `pg_restore` succeeds under `pipefail` (otherwise psql rolls back at EOF and exits 0). With FK checks off, every restore then unfiles any journey sitting in another user's trip, and stops listing any logged part whose user differs from its journey's. Pulls refuse to start while a map data deploy is running (`remote-deploy.sh --state`); a backup only warns.
### Map data deploy
`npm run deployMapData -- [--valid-only] [--concurrency=N] [--fresh] [--follow]` (`npm run deployValidMapData` is the `--valid-only` shorthand) — run locally; the work happens **on the server** (`osmium-scripts/deploy.sh`, one plink call per step into `remote-deploy.sh`).
- Pulls the server's checkout of `main`; refuses while local commits are unpushed or `osmium-scripts/`, `src/scripts/` or `package*.json` have uncommitted changes (`src/lib` only warns). Runs `npm ci` when `node_modules` wasn't installed from the current lockfile.
- Prepares the map there (no date — always the latest extracts) and imports it. The log (`data/deploy.log`) streams over `plink -t`, and **the deploy stops when that session ends** — Ctrl+C, closed terminal or dropped connection alike, since Windows plink never forwards Ctrl+C and the hangup is the only signal. Rerun to resume: a pruned file prepared from the current extract list since the last successful deploy is reused. `--follow` shows a running deploy (Ctrl+C there stops it too) or the last log; `--fresh` discards prepared files.
- At the end it prints the recalculation summary again and writes `osmium-scripts/deployed-extracts.txt` — **commit it**.
- Flags are matched by name in both `deploy.sh` and `remote-deploy.sh`; a new import flag must be added to both.
- The server needs `osmium-tool` (apt) and swap (osmium needs ~2GB to filter a country).

### App deploy
A push to `main` builds the image and redeploys (`.github/workflows/deploy.yml`) unless everything it touches is under `mobile/` or `osmium-scripts/` or is a `*.md`; `workflow_dispatch` forces one.
- Each deploy **re-applies `02-vector-tiles.sql`** before replacing the containers (one transaction, `lock_timeout` 10s — it fails rather than stalls while a map import holds the tables; rerun it afterwards). So that file must stay **idempotent**, and a change `CREATE OR REPLACE` can't make (a new return type) needs its `DROP FUNCTION IF EXISTS` there. `01-schema.sql` is never re-run — schema changes are migration scripts.
- The `tiles` container is restarted when `martin/` changed (checksum on the server); `up -d` alone keeps a dropped source published.
- Martin and PostGIS are **pinned by digest** in `docker-compose.yml`; bump tag and digest together. Pushing a new `db` image *is* the upgrade (Postgres restarts mid-deploy): take `backupRouteData` first, run `ALTER EXTENSION postgis UPDATE` after if PostGIS moved. The `db` image stays **Alpine** (musl → glibc would reorder every text index).
- The runtime environment (DB credentials, `JWT_SECRET`) lives on the server in its checkout's `.env` (`~/osm-trains/.env`), handed to compose with `--env-file` — a compose command run there by hand needs the same flag. `.dockerignore` keeps every `.env*` out of the image (Next's standalone output would copy it in), along with `data/`, `mobile/`, `node_modules` and `.next`.
- **Every published port is bound to `127.0.0.1`** — Caddy on the host proxies to 3000/3001, and a Docker-published port bypasses ufw (an exposed frontend lets a client set its own `X-Forwarded-For`).
- **A production server won't start without a `JWT_SECRET` of at least 32 bytes** (`resolveJwtSecret` in `authTokens.ts`, called from `src/instrumentation.ts`, which exits the process). Resolved on first use, because `next build` runs as production with no secret. Only development falls back to a built-in key.

### Frontend
- `npm run dev` (Turbopack), `npm run build`, `npm run start`.
- `npm run lint` (Biome check — formatter + linter), `npm run lint:fix`, `npm run format`. **All code must conform to Biome**; run `npm run lint` and resolve findings before considering a change done.
- `npx tsc --noEmit` — **always run after a batch of code changes**. Do not run full builds unless the user asks.
- `npm test` — unit tests (see "Tests").
- `npm run generateAppIcons` — re-render the home-screen icons from `assets/app-icon.png`; by hand, outputs committed.

### Prerequisites
Osmium Tool (`conda install conda-forge::osmium-tool`), Node, Docker, `tsx`, `.env` copied from `.env.example`.

## Architecture

### Data flow
`OSM PBF → filtered OSM → GeoJSON → pruned GeoJSON → Postgres → Martin (MVT tiles) → MapLibre`

### Database (Postgres 18 + PostGIS 3.6)

GIST indexes on spatial data; EPSG:3857 geometry columns kept in sync by triggers.

Type parsers (`dbConfig.ts`, global to `pg`): NUMERIC arrives as a JS number, DATE as its `YYYY-MM-DD` string, BIGINT as a string (OSM ids are handled as strings) — cast a `count(*)` to `::int` where it is read.

- **users** — email (stored `lower(btrim(...))`, folded in SQL on every write and lookup and held there by a CHECK), bcrypt password, `password_changed_at` (see "Auth").
- **stations** — OSM points; the name is resolved in `pruneData.ts`. Stations mapped as **areas** are reduced to their centroid and stored with a **negated id** (node and way ids overlap); one is dropped when a same-name station node sits within 150m. `near_route` — see "Station proximity".
- **railway_routes** — `track_id`, `name` (only where `hasRouteNames`; NULL elsewhere), `from_station`, `to_station`, `description`, `usage_type`, `frequency` TEXT[] (free-form tags, no tag table; `getFrequencyTags` returns the in-use set for `TagInput`), `link`, `line_class` ('highspeed'|'main'|'branch'), `geom`, `length_km`, `start_country`/`end_country`, `starting_coordinate`/`ending_coordinate` (exact click points), `is_valid`, `error_message`, `under_repair`, `intended_backtracking`, `has_backtracking`.
  - `usage_type`: **0 Regular** — in the official national timetable at any frequency. **1 Heritage & tourist** — a line of its own outside the national timetable (museum railways, rack railways, funiculars); drawn dotted. **2 Special** — national track used irregularly (diversions, festival or tourist runs); drawn dashed. 1 vs 2 is about whose track and whose timetable, not the kind of train; service character (daily, seasonal) goes in `frequency`. 1 and 2 are left out of stats and planner unless the region counts them as ordinary (`ordinaryUsageTypes`). Each type has its own line layer (`railway_routes`, `railway_routes_heritage`, `railway_routes_special`) and user-map toggle, since `line-dasharray` isn't data-driven.
- **scenic_lines** — `from_station`, `to_station`, `geometry`, `length_km`, countries, start/end coordinates, `is_valid`, `error_message`. See "Scenic lines".
- **railway_parts** — raw OSM segments; `usage` (main/branch/industrial/tourism), `highspeed`.
- **user_trips** — name (req), description. Groups journeys.
- **user_journeys** — name (req), description, date (req), `trip_id`. **Ownership is in the schema**: trips and journeys carry `UNIQUE (id, user_id)`, and the FKs into them are composite — `(trip_id, user_id)` and `user_logged_parts`' `(journey_id, user_id)`. Deleting a trip is `ON DELETE SET NULL (trip_id)`.
- **user_logged_parts** — `journey_id`, `track_id` (FK ON DELETE CASCADE), `partial`, `covered_start`/`covered_end` (see "Partial rides"). UNIQUE (journey_id, track_id).
- **user_preferences** — `selected_countries` TEXT[] (defaults to all of `SUPPORTED_COUNTRIES`; every write goes through `updateSelectedCountriesForUser` → `normalizeCountryCodes`), `public_map_enabled`, `public_map_token` (see "Public map sharing").
- **admin_notes** — `coordinate`, `text`, `note_type` ('Usage'|'UsageInternal'|'Works'|'Todo', NOT NULL), `source`. Only `Usage` is public; `UsageInternal` is an admin draft promoted to `Usage` to publish (`noteTypeOptions` in `constants.ts`).

### Routes and their invariants

- **Coordinate-based routing** (`scripts/lib/railwayPathFinder.ts`). A route is defined by exact start/end click points on railway parts (matched at 1m tolerance); the edge parts are truncated to them and the chain stitched by `mergeLinearChain`. BFS by hop count; a distance-weighted search only when the shortest path backtracks — that one keys on (part, end entered at) and rejects a part entered and left through the same node. Recalculation after OSM updates reuses the stored points.
- **`mergeLinearChain`** (`coordinateUtils.ts`) joins sublists **only at their first/last coordinates**, and takes them **in path order** — it must never work the order out itself. Callers catch "Chain is broken" and skip that combination.
- **Route invalidation.** No path, off-network, or >0.1km AND >1% length mismatch → `is_valid=false` + `error_message`. Grey on the admin map; "Edit Geometry" re-picks the points.
- **Under repair** (`under_repair`) marks an invalid route as only temporarily broken in OSM, as opposed to wanting a manual fix. Admin-set (`setRouteUnderRepair`, refused on a valid route), drawn violet, with its own admin filter disjoint from "Invalid". **It never outlives invalidity**: every path that marks a route valid clears it (geometry re-pick in `adminRouteActions`, successful recalculation in `verifyRouteData`); failed recalculations and metadata saves leave it.
- **Scenic lines** are their own table, drawn and recalculated exactly like routes (two click points, same pathfinder and preview, recalculated by `verifyRouteData` after the routes) but carrying only From/To and used for highlighting alone — nothing is logged against them or derived from them (no `near_route`, planner or stats). An invalid one keeps its last geometry and stays drawn. Tile `scenic_lines_tile` (public on Martin), simplified to about a pixel per zoom; drawn by `createScenicLinesLayer` as a soft violet band under the route lines. On the user map it is off by default behind the "Scenic lines" switch (only where `hasScenicHighlight`) and follows the country filter through `scenicLinesFilter`. The admin works them in the **Scenic** tab (`AdminScenicTab`, `adminScenicLineActions.ts`); while it is open the admin map hides the routes, so clicks reach the parts under them.
- **Duplicating a route clones every user's logs, on purpose** (`duplicateRailwayRoute`): duplication exists to split A–C into A–B and B–C, and everyone who rode A–C rode both. A partial ride is carried through the geometry re-pick that follows by `reprojectCoveredRanges` in `saveRailwayRoute`. A duplicate left un-split double-counts — finish the split.
- **Auto line classification** on create/edit: length-weighted majority of intersecting parts — >50% highspeed → 'highspeed', >50% main → 'main', else 'branch'. The admin can override.
- **Country detection**: `@rapideditor/country-coder` on the start and end click points (`countryAt` in `countryUtils.ts`).
- **Station proximity** (`stationProximity.ts`). `stations.near_route` = a route within 250m (`STATION_ROUTE_PROXIMITY_METERS`). It gates `public_stations_tile`, `searchStations` and `inspectPath`'s name lookup (a numeric id bypasses it); the admin map and its search show every station. **Every write that moves route geometry must refresh it**: `refreshAllStationProximity` after a bulk pass (`importMapData`, `verifyRouteData`, pulls and restores), `refreshStationProximityFor` in `saveRailwayRoute`/`deleteRailwayRoute` — an edit or delete also calls `getStationsNearRoute` **before** the write, since afterwards the stations that lost their last route can't be found. A duplicate needs nothing.

### Regions (`src/lib/shared/regions.ts`)

Europe and Japan are two views of one backend. A region is a **bounding box**: the map's `maxBounds`, and the filter in every query that must not leak the other network, always through `regionContainsSql(region, point)` (`point && ST_MakeEnvelope(...)`). Pass it a **point** — a route's or scenic line's `starting_coordinate`, a station's `coordinates`, a note's `coordinate` — never a line (`geometry &&` detoasts every route's line, ~100ms). There is no `region` column. The user map's routes need no bbox — the `selected_countries` tile filter already separates the regions. A one-country region (`hasCountryFilter: false`) hides the country list and pins the filter to its own list.

Per-region flags keep the differences declarative — never write `region.id === "japan"`:
- **`hasRouteNames`** (Japan) — every route carries a line name that identifies it: a required Name field above From in the admin forms; the routes list sorted and searched by name, with a "Without name" filter; popups, journey rows and the selection lead with it (`routeTitle`); and the map search becomes "Search lines and stations" (`searchLinesByName`). A picked line fits the map (`fitCamera`) and is highlighted as a blue band drawn from its own GeoJSON (`getLineGeometry` → `lineGeometryByName`), owned by each map's `useLineSearchHighlight`, cleared from a chip under the search box. Lines and stations are searched by **one** server action (`searchMap`, the admin's `searchAdminMap`, both over `searchMapByName`), because Next runs a client's server actions one at a time.
- **`hasScenicHighlight`** — whether the user map offers the scenic toggle and the admin page its Scenic tab.
- **`usageLabels`** — usage types the region renames (Japan: Regular "JR line", Special "Non-JR line"). Everything user-facing goes through `regionUsageLabel` / `regionUsageOptions` / `regionUsagePluralLabel`; `getUsageLabel` / `getUsagePluralLabel` in `constants.ts` are the region-less fallbacks.
- **`ordinaryUsageTypes`** — the types that are ordinary timetabled service: Europe `[0]`, Japan `[0, 2]` (Japan's Special is the non-JR operators). Heritage never. It drives progress (`ordinaryUsageSql`; `countedUsageTypes` for localStorage), the per-type rows in Map & Stats (`hasOrdinaryNonRegular`), the planner's "Include …" switch (the server only ever adds types the region counts — `ordinaryRouteSql`), and the Special layer's default (`shared/map/layerPrefs.ts`).

The selected region lives in a cookie (`REGION_COOKIE`), read by the server components for a correct first paint, and is served by `RegionProvider`/`useRegion`/`useRegionId` (`src/lib/regionContext.tsx`). Switching **clears everything picked in the old region** — selection and highlights, the planner form, the admin's selection and geometry pick, the logger's picked trip. Saved map position is per region (`railway-map-state-<region>`).

Region-scoped server actions: `searchStations`, `searchMap`, `getLineGeometry`, `getRouteSummaries`, `getRegionTrackIds`, `getUserProgress`, `getProgressByCountry`, `getJourneysAndTrips`, `getAllTrips`, `getUnassignedJourneys`, `getAllRailwayRoutes`, `getValidRoutesTotalKm`, `getAllRouteEndpoints`, `getAllAdminNotes`. A journey belongs to a region when it logged a route there, a trip when any of its journeys did; one with no routes yet belongs to every region.

### Progress and partial rides

- **Progress.** A route counts as completed if logged with `partial=false` in any journey, **or if its partial stretches add up to the whole line**; otherwise it is partial. The country filter requires BOTH endpoints in the selected list. Only `ordinaryUsageTypes` count; the map's progress box is further narrowed to the types the map shows (`countedUsageTypes`), except on the shared map (`progressFollowsLayers: false`).
- **"Ridden whole" is one rule in two implementations** (`routeCoverage.ts`): widen each logged stretch by `UNTRAVELLED_NOISE_KM` (0.3km, capped at a quarter of the route) at both ends, union them, and test for [0,1]. Stretches of unknown extent are excluded. The server's definition is the SQL `user_fully_ridden_routes` (`02-vector-tiles.sql`), behind both the map colour (`railway_routes_mvt.has_complete_trip`) and the numbers (`FULLY_RIDDEN_TRACK_IDS` in `progressQueries.ts`); it returns a set joined once per tile — don't turn it into a per-route call. `isRouteFullyRidden` mirrors it for localStorage users, fed by `getRouteSummaries` (no geometry — with it the list is ~50MB for Europe). `tests/routeCoverage.sql.test.ts` keeps the two in agreement.
- **Partial rides are a fraction range**, `covered_start`/`covered_end` in `ST_LineLocatePoint` space along the route geometry; both NULL = extent unknown (logged whole, or ticked partial by hand). Cut on read with `ST_LineSubstring` (`getCoveredStretches`) and **never simplified** — the overlays are drawn over the route's own line. Only the Journey Planner produces a range, and it is dropped on write unless `partial` is set (`sanitizeRange`). Rows for one route are never merged.

### Auth and security

- **Auth.** Email/password + bcrypt + session cookie. Anonymous users get localStorage (`localStorage.ts`, imported as `localStore`) behind the `dataAccess.ts` abstraction; `migrationActions.ts` migrates on login.
- **A signed token is not enough; the account has to agree** (`sessionQueries.ts`; the rule is written once, as SQL, in `currentAccountIdSql`). A token is refused if issued before the user's `password_changed_at` or if the user is gone. `authTokens.ts` only reads tokens (`readToken`) and never touches the database; `verifyToken` applies the rule for the cookie (`getUser`, per request via React `cache`), the bearer and the refresh; the tile handlers embed it in the tile query. Compared on the `iatMs` claim (falling back to `iat`). **Anything that sets a password must set `password_changed_at = now()` beside it.**
- **A password check is capped and costs the same on every path.** An unknown email compares against `ABSENT_USER_HASH`. `rateLimit.ts`: 10 sign-ins per 5 minutes and 5 registrations per hour, in memory, keyed on the **client address only, never the email**; the address is the rightmost `X-Forwarded-For` hop, never `X-Real-IP`; IPv6 is keyed by its /64; **every attempt counts, successes included**. Enforced on both transports (`api/v1/auth` and `authActions.ts`); `RateLimitError` → 429 with `Retry-After`.
- **Admin = user_id 1** (reserved, see `createAdmin`). Every admin server action is `return asAdmin(async () => …)` (`authHelpers.ts`), which returns its refusal and the action's `ValidationError`s as `{ error }` — so every call site reads it through `unwrap`, including those that ignore the value. A Biome plugin enforces this (see "Linting").

### Two transports, one set of queries

User-scoped queries live in plain server-only modules taking a `userId` — `progressQueries.ts`, `journeyQueries.ts`, `tripQueries.ts`, `preferencesQueries.ts`, plus the user-less `routeQueries.ts`, `authQueries.ts`, `routePathFinder.ts`. Three thin callers resolve who is asking and delegate: the `*Actions.ts` modules (session), `publicMapActions.ts` (share token), and the `src/app/api/v1` handlers (bearer).

- **A route handler never imports a `"use server"` module, and a query taking a user id is never exported from one** — every export of a `"use server"` file is a client-callable endpoint. Where a needed query sits inside an action, lift it out.
- **Errors.** Queries return plain values and throw `ValidationError` (→ 400), `NotFoundError` (→ 404) or `RateLimitError` (→ 429) from `errors.ts`; anything else is an opaque 500, so no Postgres text reaches a client. A production build replaces the message of anything thrown out of a server function, so actions wrap with `asActionResult` (`actionResult.ts`) to *return* `{ error }`; the client re-throws with `unwrap` (as `ActionError`) and shows it through `actionErrorMessage(error, fallback)`. `asUser` / `asAdmin` (`authHelpers.ts`) apply it to every journey, trip and admin action; `login`/`register` use it too.
- **The HTTP API (`/api/v1`)** exists for the native app only — see `API.md` and `MOBILE_APP_PLAN.md`. Bearer auth (`Authorization: Bearer …`), same secret as the cookie, which a handler never reads. `region` is explicit everywhere and **never defaults**. Versioned from the first commit.

### Vector tiles and sharing

Martin (port 3001) serves `railway_routes_tile` (`selected_countries` filter, no user), `railway_parts_tile` (zoom-filtered), `stations_tile` (z9+, every station — admin map), `public_stations_tile` (`near_route` only — user map; both emit the layer name `stations`), `public_notes_tile` (`Usage` notes, text + source only), `scenic_lines_tile`.

- **Nothing Martin publishes may depend on who is asking** — Martin answers anyone, with no session in sight.
- **`railway_routes_mvt`, the tile coloured by someone's rides, must never be added to `martin/configuration.yml`.** It is served by `api/tiles/railway_routes/[z]/[x]/[y]`, which resolves whose rides on every tile: `?share=<token>` (only while sharing is on), else a bearer token, else the session cookie. A missing or dead credential is a 401/404, never an uncoloured tile that would pass for an unridden map. The client never names a user — `createRailwayRoutesSource({ rides: "session" | { shareToken } })`; without `rides` the source stays on Martin. It queries through its own pool (`routeTileQueries.ts`).
- **`admin_notes_tile` is kept out of Martin too**, served by `api/tiles/admin_notes/[z]/[x]/[y]` with an admin session check on every tile (401 / 403). These two handlers are the only ones that read the cookie; they share `lib/api/tiles.ts`.
- Line tiles are simplified by one tile unit (`tile_unit(z)`, the grid `ST_AsMVTGeom` snaps to), which keeps them within about a quarter pixel of the full-resolution overlays drawn over them; don't raise it. Tiles from the Next handlers are gzipped by `mvtResponse` (Next won't compress protobuf).
- **Every `pg` pool needs an `error` listener**, or an idle connection dying takes the process down — so every pool is made by `createPool` (`db.ts`), which attaches it.
- Zoom ranges: `ZOOM_RANGES` in `lib/shared/map/zoomRanges.ts` (its header lists what else must match).
- **An MVT property is a scalar**: `frequency` arrives as a Postgres array literal. Decode with `parsePgTextArray` / `parseFrequencyTags` (`map/routeFeature.ts`), never `split(",")`.

**Public map sharing** — `/shared/<token>?view=<region>` (`ShareMapDialog`, `publicMapActions.ts`). The token is minted on the first read of the sharing settings (`getPublicMapSettings`) and never changes, so a pasted link keeps working; `public_map_enabled` alone grants access. Every public read — every route tile included — re-resolves the token through `sharedMapOwnerIdSql` (`publicMapQueries.ts`), so switching sharing off stops an open map drawing routes at once. `?view=` wins over the visitor's region cookie. On the client the shared view is a third `DataAccess` (`createPublicDataAccess`), whose preference write throws.

### Journey planner (`routePathFinder.ts`, `src/lib/planner/`)

Searches over **whole routes**, not OSM parts. `routePathFinder.ts` is the flow and the reads; `planner/` holds the network model (`routeGraph.ts`, pure) and its cache (`routeGraphCache.ts`), the search (`routeSearch.ts`, pure), each station's routes (`stations.ts`) and the travelled stretches (`routeVisits.ts`, pure). Nodes are `(track_id, exit endpoint)`; edges join endpoints within `ENDPOINT_TOLERANCE_METERS` (500m). Dijkstra; cost = `length_km × line_class multiplier` (highspeed 0.5, main 1.0, branch 2.0) + gap penalty. It rides Regular routes, plus the region's ordinary non-Regular ones when `PlannerOptions.includeSpecial` asks (`ordinaryRouteSql`, `plannerRouteSql`).

Invariants (the modules carry the reasoning):
- State includes the exit endpoint, so a route is entered at one end and left at the other. The entry side is the **nearer** endpoint, not the first within tolerance.
- The terminal routes are costed for the stretch travelled, from `ST_LineLocatePoint` fractions; so the search keeps the cheapest finish and runs until nothing queued can beat it. An end route is never travelled through.
- `GAP_PENALTY_PER_KM` (25) charges the gap at each connection, so the search can't skip a junction complex's short connectors. `inspectPath` prints the gaps — tens of metres is normal, hundreds means something was skipped.
- The whole network is loaded at once (endpoints only) into a spatial grid, and the built graph is cached keyed on a `count(*)`/`sum(xmin)` fingerprint of `railway_routes` — not on `updated_at`.
- Station → routes is one indexed query with progressive tolerance (100m → 5km) in memory. **Never `ST_DWithin` on a `::geography` cast** (no index, ~860ms a call) — use `withinMetersSql` (`mercatorDistance.ts`).
- Every route is trimmed to the stretch travelled (`planVisits` → `planTrims` → `cutTravelledStretches`), getting `partial` + `travelled_length_km`. The endpoints travelled come from the search (`SearchResult.sides`), never inferred. A route visited twice or left with under `MIN_UNTRAVELLED_KM` (0.3km) untravelled stays whole; one barely touched (stop within 0.3km of its endpoint) is dropped; a plan with no route left is refused.
- A segment after a via is seeded from every route serving the via; changing lines there costs the gap between the lines at the station (× `GAP_PENALTY_PER_KM`) plus `VIA_CHANGE_PENALTY` (5) — `changeCosts`.

### Map styling

`src/lib/shared/map/style.ts` is the **single source of truth** for colours, widths and opacities (`COLORS`, `WIDTHS`, `CIRCLES`, `LABELS`, `OPACITIES`). Route colour = visit status × line_class; width is one z4→z7 interpolate. An invisible wide `railway_routes_click` layer (every shown usage type, `clickBufferFilter`) gives touch hit areas.

- **No `["all", ...]` in data-driven paint expressions.** MapLibre Native's React binding crashes (`std::bad_alloc`) converting a `case` with an `all` condition beside another branch. Write nested single-condition `case`s and use `match` for a value fan-out (`userRouteStyling.ts`, `lineClassColorExpression`).
- **Popups are raw HTML** (`setHTML`): every interpolated value goes through `escapeHtml()` and every URL through `safeHref()` (`utils/tooltipFormatting.ts`). Station names come from OSM, i.e. from third parties. Popup inline styles read `var(--color-…)`, since no stylesheet can reach them.

**Basemap** (`basemap.ts`) — OpenFreeMap `liberty` (vector; `dark` in dark mode), vector so the labels can be rewritten to Latin script (`latinizeLabels`: `coalesce(name:latin, name_en, name)` on layers that *read* a name). On top of it, each explained in the file: a `background` fade layer (`createBasemapFadeLayer`), admin_level 2 country borders redrawn above the fade (`createCountryBordersLayer`), POI layers dropped (`dropPoiLayers`), missing icons backfilled (`src/lib/map/missingIcons.ts`), park label points filtered out of `park_outline`, buildings flattened (`flattenBuildings`).
- The style is fetched **before** the map is created (`loadBasemapStyle`, memoised; resolves null on failure or a 6s timeout → OSM raster fallback). Never `setStyle` later — it discards our layers. Never mutate the memoised layer objects.
- **Station labels are ours** (`createStationLabelsLayer`, `LABELS.station`, styled after openstreetmap-carto — keep the halo translucent).
- **`text-font` must name exactly one font.** MapLibre joins the array into one glyph URL, which OpenFreeMap 404s, and the text silently falls back to a system font. Text also needs `glyphs`; the raster fallback declares `GLYPHS_URL`.
- Refresh route tiles with `setTiles` on the existing source, never by removing and re-adding the layers (they would land above the station labels and lose their state).
- The attribution starts collapsed (`addAttribution` in `useMapLibre`). The map never rotates, by touch either.

**Highlights and overlays**:
- Selection colours: Route Logger orange `#ff6b35`, Journey Planner gold `#FFD700`, My Trips orange.
- A highlight set is split by usage type (`highlightVariants`, `shared/map/highlightLayers.ts`, shared with native), reusing the base layer's width and dash; the non-regular variants get a translucent solid casing underneath. The casings are in `HIGHLIGHT_LAYER_IDS`, which gives Heritage/Special routes their hit area.
- **Clear a highlight by filtering its layers to nothing, never by removing them** (`syncHighlightOverlay`) — MapLibre keeps parsed tile features per layer id, so a re-added layer flashes the old ones.
- Routes covered only in part (the planner result, and the Route Logger selection while `partial` is ticked) are drawn from a per-set `<baseId>_partial` GeoJSON source instead (`PartialRouteGeometry`); those layers are not in `HIGHLIGHT_LAYER_IDS`.
- **Ridden stretches** (`shared/map/coverageLayer.ts`; `useCoverageOverlay` on the web) are green over the route, from a `logged_coverage` GeoJSON source, one layer per usage type, moved before `stations`, repeating the route layers' usage and country filters. Sync as soon as the data arrives — don't gate on `isStyleLoaded()`.
- **Opening something flies to it** — `{ fit: true }`, the fourth argument of `HighlightRoutesFn`, with a bbox from the server limited to the region (`routeBoundsByIds`, returned with `getJourney` / `getTrip` / the planner result; `getRoutesBounds` for local journeys). Only on open; a pending fit is dropped by any later highlight or camera move (except the `sheetPadding` jump). `fitCamera.ts` keeps clear of the progress box and the sheet; `FIT_MAX_ZOOM` caps it.

### Touch interactions (`src/lib/map/interactions/userMapInteractions.ts`)

- **A map click never inherits `partial`** — it selects with `partial: null`.
- **Touch gets a sheet, not a hover popup.** The mode is decided per interaction by `lastPointerWasTouch`, not by screen width. On touch a tap opens the feature's sheet with buttons (Add to selection / Open website) instead of acting, and the double-click handler stands down.
- A sheet with an action is placed so its button sits under the finger (`anchor: "center"` + a measured offset), and has no × — every tap ends it.
- `sheetTookThisClick`, consulted first by every click handler, tells sheet taps from map taps by the sheet's rect, swallows taps for `SHEET_TAP_GRACE_MS` (400ms) around opening and closing, and suspends double-click zoom meanwhile. MapLibre's `closeOnClick` stays off.
- `useUserMapInteractions` attaches the handlers **once per map** and reads the callbacks through `useEffectEvent`; it cancels a setup deferred to `"idle"` on teardown. A sheet therefore outlives callback changes, so its button re-asks `routeTapAction` before acting.
- The button says what it will do ("Add to selection", "Remove from journey"…) via `routeTapAction` and a journey card's `isRouteInJourney` (`JourneyEditStartFn`).
- Popups get `z-index: 30` in `globals.css`: under the toasts (50), over the map furniture.

## Code structure

### Routes (`src/app/`)
- `page.tsx` — main map (→ `MainLayout`).
- `admin/page.tsx` — admin route management (user 1 only).
- `shared/[token]/page.tsx` — a shared map (→ `PublicMapLayout`); resolves the token server-side, so an unshared link renders "not available".
- `api/tiles/railway_routes/[z]/[x]/[y]` and `api/tiles/admin_notes/[z]/[x]/[y]` — see "Vector tiles".
- `api/v1/**` — the native app's API (`API.md`). Thin handlers: resolve the bearer, validate, call a query module, map to a status.

### Components (`src/components/`)
One directory per part of the app; always import a component by its full path (`@/components/<dir>/<Name>`), from a sibling too.

- **`logbook/`** — the sidebar and its tabs: `UserSidebar`, `RouteLogger` (the Route Logger tab, either store), `JourneyLogger` (auth) / `LocalTripLogger` (anon) wrappers, `JourneyMetaFields`, `LoggedRouteRow`, `JourneyPlanner`, `JourneysAndTripsTab`, `TripCard`, `JourneyCard`, `CardHeader`, `SelectionSummaryBar`, `LocalJourneyLogTab`, `MapStatsTab`.
- **`map/`** — `RailwayMap` (the user map), `MapStationSearch` (station and line search, used by all three maps), `MapProgressBox` (user and public maps; layer switches only on the shared map, `withLayerToggles`), `LayerToggles` (the region rules for which switches exist).
- **`sharing/`** — `PublicMapLayout`, `PublicRailwayMap` (read-only by calling `useUserMapInteractions` without `onRouteClick`), `ShareMapDialog`.
- **`admin/`** — `AdminPageClient` (holds the open tab, `useRoutePreview` and the selected route's detail), `AdminMap`, `AdminLayerControls`, `AdminSidebar`, `AdminCreateRouteTab`, `AdminRoutesTab`, `AdminScenicTab`, `AdminNotesTab`, `PickedPointField`, `RoutesList`, `RouteEditForm`, `RouteMetadataFields`, `NotesPopup`. The route preview is derived from the picked points, and dropped when they change.
- **`layout/`** — `MainLayout`, `Navbar`, `ServiceWorkerRegistrar`, `MenuSheet`.
- **`auth/`** — `LoginForm`, `RegisterForm` (rendered only by `MenuSheet`).
- **`articles/`** — `HowToUseArticle`, `RailwayNotesArticle` (the menu supplies title and back arrow).
- **`ui/`** — `MobileBottomSheet`, `ToggleSwitch`, `RegionSwitch`, `ThemeSwitch`, `TagInput`, `StationSearchInput`, `Icon` (**every icon in the app**, by name — add a new glyph there, never an inline `<svg>`; its stroke weight is set by its group, not the call site), `IconButton` (a label-less `iconBtn` around one, whose glyph size follows the button size; other button attributes pass through).

### Library (`src/lib/`)
- **Queries** (server-only): `db.ts` (pool, `asMissingRow`, `withTransaction`), `dbConfig.ts`, `progressQueries.ts`, `journeyQueries.ts`, `tripQueries.ts`, `preferencesQueries.ts`, `routeQueries.ts`, `authQueries.ts`, `passwordHash.ts`, `authTokens.ts`, `sessionQueries.ts`, `publicMapQueries.ts`, `routeTileQueries.ts`, `adminNotesTileQueries.ts`, `errors.ts`.
- **Actions** (`"use server"`): `userActions.ts`, `journeyActions.ts`, `tripActions.ts`, `userPreferencesActions.ts`, `authActions.ts`, `plannerActions.ts`, `publicMapActions.ts`, `migrationActions.ts`, `adminRouteActions.ts`, `adminScenicLineActions.ts`, `adminMapActions.ts`, `adminNotesActions.ts` (their shared input checks in `adminValidation.ts`, a plain module since a `"use server"` file exports only actions).
- **API plumbing** (`api/`): `auth.ts`, `params.ts`, `response.ts` (`apiHandler`), `tiles.ts`.
- **Data access**: `dataAccess.ts` (database / localStorage / public), `localStorage.ts`, `shared/progress.ts` (the progress types and rounding — the server, the localStorage count and the native app use the same ones).
- **Planner**: `routePathFinder.ts`, `planner/`.
- **Regions**: `shared/regions.ts`, `regionContext.tsx`.
- **Theme**: `theme/index.ts` (the preference, `useResolvedTheme`, `THEME_INIT_SCRIPT`), `theme/colors.ts` (`THEME_COLORS`, a plain module so `app/manifest.ts` can read it), `shared/theme/types.ts`.
- **Layer prefs**: `shared/map/layerPrefs.ts` (stored form and per-region resolution, shared), `map/layerPrefs.ts` (localStorage), `map/layerPrefsContext.tsx`. Held above the map by the layouts, inside `RegionProvider`. The Special and Regular switches are stored per region; `showRegular` exists only where `hasOrdinaryNonRegular`; `switchableUsageTypes` decides which switches a region has. Highlights ignore the switches.
- **UI**: `ui/buttonStyles.ts`, `ui/inputStyles.ts`, `ui/useSearchCombobox.ts`, `ui/useModalDialog.ts`, `ui/useSingleFlight.ts` (one admin save at a time, failure toasted), `ui/adminListSort.ts` (sorted in the browser with a fixed `en` collation).
- **Utils**: `shared/types.ts`, `shared/constants.ts`, `shared/routeCoverage.ts`, `selectedRoutes.ts`, `stationProximity.ts`, `mercatorDistance.ts`, `lineLength.ts` (`lineLengthKmSql`, the one expression behind every stored `length_km` and the admin preview), `coordinateUtils.ts` (WKT out, `lngLatSql` to read a point column back as `[lng, lat]`), `countryUtils.ts`, `shared/countryFlag.ts`, `shared/getUntimezonedDateStr.ts`, `plural.ts`, `rateLimit.ts`.
- **Toast**: `toast/` (`useToast`, `ToastContainer`, `ConfirmDialog`).

### Map library (`src/lib/shared/map/`, `src/lib/map/`)

**`shared/map/`** is shared with the native app, so a decision about what the map draws is made once: `style.ts`, `layers.ts`, `tileSources.ts` (URL templates taking the tile host as an argument; query strings built by hand for RN), `zoomRanges.ts`, `basemap.ts`, `userMapLayers.ts` (the user map's route layer stack, `scenicLinesFilter`, `clickBufferFilter`), `highlightLayers.ts`, `coverageLayer.ts`, `routeFeature.ts` (`routeTitle`, `routeBadges`, `parseFrequencyTags`), `layerPrefs.ts`, `utils/userRouteStyling.ts`.

**`map/`** is the web app's: `index.ts` (re-exports plus the tile hosts bound from `window.location` — never import it from RN), `missingIcons.ts`, `mapState.ts`, `fitCamera.ts`, `utils/tooltipFormatting.ts`, `interactions/` (`userMapInteractions.ts`, `adminMapInteractions.ts`), and `hooks/`: `useMapLibre`, `useUserMap` (what both user maps draw), `useSourceTileRefresh` (`setTiles` on the existing source — the map is built once per region and scheme, never rebuilt for a refresh; `useUserMap` drives it for the route tiles, keyed on the URL's inputs), `useRouteHighlighting` (`kind: 'planner' | 'view'`), `useCoverageOverlay`, `useLayerFilters`, `useUserMapInteractions`, `useLineSearchHighlight`, `useLocalRouteFeatureStates` (an anonymous visitor's rides as feature state, cleared on login), `useRoutePreview` (length measured by the server with `lineLengthKmSql`), `useAdminLayerVisibility`, `useAdminMapOverlays`, `useAdminNotesPopup`.

### Scripts (`src/scripts/`)
- **Data**: `pruneData.ts` (resolves the station name — CJK prefers `name:ja_rm`, `name:ja-Latn`, then `name:en`; Cyrillic/Greek are transliterated), `importMapData.ts`, `verifyRouteData.ts`, `applyVectorTiles.ts`, `markAllRoutesInvalid.ts`, `fixSequences.ts`, `createAdmin.ts`, `listStations.ts`, `inspectPath.ts`, `showBacktracking.ts`, `serverData.ts`.
- **Assets**: `generateAppIcons.ts`, `copyMaplibreWorker.ts` (runs on `predev`/`prebuild`).
- **Shared** (`scripts/lib/`): `runPool.ts`, `geojsonFeatureStream.ts`, `pgDumpArchive.ts`, `loadRailwayData.ts`, `railwayPathFinder.ts` over `partNetwork.ts` and `partGeometry.ts` (pure).

**GeoJSON is streamed** through `streamFeatures` (`geojsonFeatureStream.ts`), which tracks string and escape state (OSM tag values contain braces). Parse failures and truncated input are counted and raised, never skipped.

**Importing is all-or-nothing** (`loadStationsAndParts`): every file is validated first (present, non-empty, ending in `]}`), then the clear and reload run in one transaction. `DELETE`, not `TRUNCATE`, which would block every tile query for the length of the import.

### Database files (`database/init/`)
- `01-schema.sql` — tables and indexes. Never re-run on deploy.
- `02-vector-tiles.sql` — tile functions, 3857 columns and triggers, `user_fully_ridden_routes`, `immutable_unaccent`. Re-applied on every deploy — keep it idempotent.

### OSM scripts (`osmium-scripts/`)
`prepare.sh` (the pipeline), `extracts.txt` (add a line to add a country), `deploy.sh` / `remote-deploy.sh`, `deployed-extracts.txt` (commit after a deploy).

## UI structure

### Dark mode
**The palette is the token layer**: `html.dark` in `globals.css` re-points Tailwind's neutral ramp, so an ordinary `bg-gray-50` / `text-gray-700` / `border-gray-200` is dark-correct for free. Use `bg-surface` / `text-fg` rather than `bg-white` / `text-black`; literal `white` and `black` mean the literal colour (text on a solid button, scrims, the toggle knob). Accent ramps flip only at their ends (50–300 and 700–950); 400–600 stay put, so `bg-blue-600 text-white` keeps working. A `hover:` meaning "a step deeper" needs a literal-hex `dark:` override (mostly in `buttonStyles.ts`).

It is a **setting** — Light / System / Dark (`ThemeSwitch`, `src/lib/theme`) — kept in **localStorage**, not `user_preferences`, so the shared map follows the visitor. `THEME_INIT_SCRIPT` in `layout.tsx`'s `<head>` sets the class, `color-scheme` and `theme-color` before the first paint (hence `suppressHydrationWarning`). A scheme change rebuilds the map; the basemap swaps to OpenFreeMap `dark`, and the layers picked against the ground take the scheme: stations (`COLORS.stationsDark`) and the user map's route visit states (`routeColors(theme)` through `userRouteLayerConfigs(theme)` — three hues, highspeed lighter rather than darker; the admin map keeps the light palette). Popup badges carry a `dark` pair, written on the web as a light fallback then CSS `light-dark()`.

### Interactive states
Every control answers to **hover, active, focus-visible, disabled**, applied in two places and never by hand at a call site:
- `src/lib/ui/buttonStyles.ts` — a named class per button role (`btn(variant, size)`, `iconBtn`, `tabBtn`, `optionRow`, `LINK_BTN`). `active:` matters: Tailwind v4's `hover:` never paints on a phone. Hover/active are `not-disabled:` (unlike `enabled:`, it matches an `<a>`).
- `globals.css`, `@layer base` — `cursor: pointer` and the `:focus-visible` outline (layered so `cursor-*` utilities still win). Inside `overflow-hidden`, inset the outline (`focus-visible:-outline-offset-2`).

**A call site adds layout only** (`w-full`, `flex-1`, margins) — an appended appearance utility wins or loses by CSS source order. A new size goes in the table's `SIZES`.

### Installable app
A web app made installable, not the native app: manifest (`src/app/manifest.ts`, `display: "standalone"`), icons rendered by `generateAppIcons.ts` (`apple-icon.png` on a white ground, since iOS fills transparency with black; the maskable icon fits the 80% safe circle), and `theme-color` written by `THEME_INIT_SCRIPT` rather than Next's metadata, because the scheme is a setting. **`public/sw.js` caches no HTML and no data** — only `/_next/static/` (cache-first, capped at 150 entries) and `/maplibre/` (stale-while-revalidate); never cross-origin. Registered in production only; in development `ServiceWorkerRegistrar` unregisters leftovers. `/sw.js` is served `no-store`.

### Modals
`ConfirmDialog`, `ShareMapDialog` and `MenuSheet` are native `<dialog>`s opened through `useModalDialog` (`showModal()` — dialog role, inert background, focus in and back, Escape for the topmost only). Mount the component only while open. Escape is reported through `onDismiss`. A centred dialog needs `m-auto`; the scrim is the literal `backdrop:bg-[rgb(0_0_0/0.5)]` (older browsers' `::backdrop` didn't inherit custom properties). The top layer covers the toasts too.

### Safe areas
`viewportFit: "cover"` + the `safe-area` utility on the three `h-dvh` page roots. `absolute` map furniture needs nothing; anything **`fixed`** must add its own inset (`MenuSheet`, the admin drawer, the toast stack via `safe-area-bottom`).

### Suggestion dropdowns
Both station searches use `useSearchCombobox` (300ms debounce, two-character floor, latest-request guard, keyboard, ARIA combobox with `aria-activedescendant`). The list `preventDefault`s on **pointerdown** so focus never leaves the input — which is why **selecting a result blurs the input explicitly**, or the on-screen keyboard stays up.

### Journey dates
Always through `formatDateOnly` / `formatDateOnlyRange` (`shared/getUntimezonedDateStr.ts`), in the viewer's locale — never `new Date("YYYY-MM-DD")`, which is UTC midnight and prints the day before west of UTC.

### Sidebar (main map)
Desktop: resizable left sidebar (360–1200px; until dragged `clamp(360px, 40vw, 600px)`, after that the dragged width, kept in localStorage per page and capped to leave 360px of map — `useResizableSidebar`). Mobile: `MobileBottomSheet` over the map — snaps collapsed / peek 120px / half / 90%, dragged by the handle or the tab bar (`data-sheet-drag`), flicks projected along their velocity, or ArrowUp/ArrowDown.
- **It moves by `transform`, never by layout, and a drag renders nothing** (the position lives in a ref and is written to the DOM). What it covers is reported every frame (`onCoverChange` → `--sheet-visible` on the map pane, lifting MapLibre's bottom controls and `MapProgressBox`) and on settling as **camera padding** (`onSettled` → `handleSheetSettled`, which moves the centre to compensate). Below `MAP_FURNITURE_MIN_HEIGHT_PX` of visible map the station search and the top controls hide. `z-40`. A scrim dims the map past half. At peek with routes selected, `SelectionSummaryBar` replaces the content. Content can move it with `useBottomSheet()?.snapTo(...)` (null on desktop).
- **Tabs: Route Logger, My Trips (auth) / My Journeys (anon), Map & Stats** ("Map" on a phone), in every region. `activeTab` lives in `MainLayout`. Map clicks act only in the Route Logger tab. **The Route Logger tab is hidden, not unmounted**, so the planner and a half-filled form survive; `UserSidebar` bumps `tripsVersion` when My Trips changes something. **The map shows only the open tab's highlights** (`TAB_HIGHLIGHT_KIND`: `planner` ↔ Route Logger, `view` ↔ My Trips).

### Menu (hamburger)
`MenuSheet` at every width — a full-screen sheet on a phone, a right-hand drawer on desktop (shape chosen in CSS on `.menu-sheet`, not by React): the app-wide settings (region switch, colour scheme), the two articles, the admin link, auth in a footer. The layer switches are not here — they are used while looking at the map, which the menu covers (see Map & Stats). Sub-views (auth forms, articles) drill down with a back arrow; focus is moved explicitly on every view change (`data-opens`).

The **navbar** keeps identity and auth (mobile: auth icon, share glyph, hamburger; desktop: welcome line, Share Map, Admin, auth buttons, hamburger). It owns no form — its buttons call `onOpenMenu("login" | "register")`. The Admin link is in both bar and menu on purpose. The admin page has no menu: its hamburger opens the sidebar drawer, and the region and colour-scheme switches sit in the bar (the scheme as one cycling button on a phone, `ThemeCycleButton`). **The navbar picks its layout with `md:` classes, not `useIsMobile`** — it paints before the JS loads. Mobile touch targets have a 44pt floor (`min-h-11`, `md:`-reset).

### Route Logger
Click routes to select; click stations to fill the planner (a station wins over the route under it; on touch it opens the station's sheet instead). Per-route partial toggle and remove; "Log Journey" (name req, description, date defaulting to today). The embedded Journey Planner: from / via* / to (vias reordered with ▲▼ — not HTML5 drag-and-drop, which iOS never fires), diacritic-insensitive autocomplete through `immutable_unaccent` (call the wrapper, not `unaccent`, or the trigram index goes unused), gold result highlight, "Add Routes to Selection". A route the plan only partly covers arrives with `partial` ticked and its stretch attached.

### My Trips / My Journeys (auth)
`JourneysAndTripsTab` — paginated (10/page, `getJourneysAndTrips(page, pageSize, search)`), 300ms debounced search; trips (with nested journeys) and standalone journeys sorted by effective date desc. One top-level card open at a time, plus one nested journey. **A card opens to a view**; only **Edit** starts the map edit session (`onJourneyEditStart`) and lowers the sheet to half. While editing, the card's own header is locked (other ways of closing it still discard silently — `TODO-UI.md`). A journey that fails to load shows Retry.

Trip stats come from `tripStatsSql` (`tripQueries.ts`); a page passes its trip ids in, so only those are aggregated. Journey and route stats are aggregated in **separate subqueries** (a direct join fans out), over `DISTINCT (trip_id, track_id)`. Distance is **what was travelled**: a known partial stretch counts its length (`LOGGED_KM_SQL`), a trip unions its journeys' stretches (`range_agg`), and an unknown extent counts the whole line — the same rule as the Route Logger's `loggedLengthKm`.

### Map & Stats
Everything that decides what the map draws, split by what is counted (`MapStatsTab`). **Show on map** first: `LayerToggles` switches for the lines drawn but never counted (Heritage, Special where it isn't ordinary), plus the scenic highlight where `hasScenicHighlight` — no lines of its own, a band over existing routes, which the hint spells out. Then, where `hasStatsView`, the counted rows — ticked, an entry is hidden on the map *and* left out of the numbers. In Europe the region's countries with flags, Select All / None, per-country stats from `getProgressByCountry()` (one `GROUPING SETS` query; a route counts where both endpoints are). Persisted in `user_preferences`; filters the map and stats; **the admin map ignores it**. Where `hasOrdinaryNonRegular` (Japan) per-type rows instead, whose checkboxes are that type's layer switch (`showRegular` / `showSpecial`). Native: `mobile/app/countries.tsx`.

### Shared map (`/shared/<token>`)
Top bar: "<owner>'s Railway Logbook", region switch, "Go to my own map". Keeps popups, search, the layer switches (in the progress box) and progress; no sidebar, no selection. `ShareMapDialog` has one switch and shows the link only while it is on.

### Admin
Click a railway part → exact start/end coordinate. Right-click → create a note; right-click a note → edit/delete (type req, text, optional source; Ctrl+Enter saves, Esc closes). Notes are coloured by type (`Usage` blue, `UsageInternal` light blue, `Works` orange, `Todo` purple); `AdminNotesTab` filters and switches type (= publish / unpublish). Invalid routes are grey with a banner and "Edit Route Geometry"; its "Mark as under repair" toggle turns them violet. Scenic tab where `hasScenicHighlight`. In naming regions, a required Name field and a "Without name" filter.

## Development workflow

### Database migrations
Schema changes and data transforms are a TS script in `src/scripts/`: import `pool` from `../lib/db`, run SQL, log progress, exit. Reference: `markAllRoutesInvalid.ts`. Register it in `package.json` and document it under "Database ops" and "Scripts" here.

### Route recalculation performance
Read `RECALC_PERFORMANCE.md` before touching `verifyRouteData.ts`, `scripts/lib/railwayPathFinder.ts`, `partNetwork.ts` or `partGeometry.ts` for performance. Don't shrink the pathfinder's buffer, don't wrap the run in a transaction, don't silence the pathfinder from outside.

### Tests
`npm test` runs `tests/*.test.ts` with Node's `node:test` through tsx — no framework. They cover the pure logic where a mistake is silent: `routeCoverage.ts`, `parsePgTextArray`, `normalizeCountryCodes`, `mergeLinearChain`, the GeoJSON stream, the planner's search and trims (networks built with `buildRouteGraph`), `selectedRoutes.ts`, `shared/map/layerPrefs.ts`, `scripts/lib/partGeometry.ts`. Run them after touching any of those. They live in `tests/` because the shared folder can't import `node:test`, and import through `@/`.

`routeCoverage.sql.test.ts` needs the database (it skips itself otherwise): it shadows the tables `user_fully_ridden_routes` reads with temp tables in a rolled-back transaction, so a new table the function reads needs a temp twin there.

### Type checking
Run `npx tsc --noEmit` after each batch of related changes. Don't run full builds unless asked.

### Linting & formatting
Biome is the single linter + formatter (`biome.json`). All code must conform — run `npm run lint` and fix findings before finishing.
- The GritQL plugin `biome-plugins/unwrapActions.grit` requires every call to something imported from `@/lib/admin*Actions`, `@/lib/journeyActions` or `@/lib/tripActions` to be `unwrap(await action(…))` or `action(…).then(unwrap)`. When editing it, look imports up among the module's top-level items (`$program <: JsModule(items=$items)`), never with `$program <: contains` (lint goes from 2s to 19s).
- **Never blanket-apply `--unsafe`**: the `useExhaustiveDependencies` autofix mangles intentional dependency arrays. Fix hook deps by hand, or add `// biome-ignore lint/correctness/useExhaustiveDependencies: <reason>`.

### TypeScript
ESNext modules, strict mode, scripts run via `tsx`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
