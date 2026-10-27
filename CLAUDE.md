# CLAUDE.md

Guidance for Claude Code working in this repo. This file holds the commands and the rules that cut across the codebase. Each area keeps its own notes in a CLAUDE.md beside its code, which loads when you read a file there. The reasoning behind each rule lives in the code comments of the file it points to; read those before changing the behaviour.

**Area notes.** Read the matching file first when you change an area from outside its directory:
- `src/lib/shared/map/CLAUDE.md`: what the map draws (styling, paint-expression rules, basemap, highlights), for both apps
- `src/lib/map/CLAUDE.md`: the web map (lifecycle, popups, touch interactions, fit-to)
- `src/components/CLAUDE.md`: UI (dark mode tokens, button styles, modals, bottom sheet, drafts, Map & Stats). Also covers `src/lib/ui/`, `src/lib/theme/` and `src/app/globals.css`.
- `src/lib/planner/CLAUDE.md`: Journey Planner invariants, including `src/lib/routePathFinder.ts`
- `src/scripts/CLAUDE.md`: pathfinding, import, server data, migrations
- `database/CLAUDE.md`: schema and tile SQL (`02-vector-tiles.sql` is re-applied on every deploy)
- `osmium-scripts/CLAUDE.md`: OSM pipeline and map data deploy
- `mobile/CLAUDE.md`: the native app

## Overview

A unified Next.js app for OSM railway data. It fetches, processes and visualizes railway data for two regions: 21 European countries (`SUPPORTED_COUNTRIES` in `src/lib/shared/constants.ts`) and Japan (`REGIONS` in `src/lib/shared/regions.ts`). One database, one pipeline, one deploy, with a single `package.json`, `.env` and container. Data processing scripts live under `src/scripts/` beside the web app. Data flow: `OSM PBF → filtered → GeoJSON → pruned → Postgres → Martin (MVT) → MapLibre`.

**`mobile/` is a second app** (React Native / Expo) with its own `package.json`. The root `tsc` excludes it (run `npm run typecheck` inside `mobile/`); one root `npm run lint` covers both.

**`src/lib/shared/` is shared with `mobile/`**, which imports it as source (`@shared/*`). A change there is a change to both apps. The web app imports it as `@/lib/shared/...`; inside the folder, imports are relative. **Biome enforces the boundary** (`overrides` in `biome.json`). A shared file may not import `pg`, `maplibre-gl` (take spec types from `@maplibre/maplibre-gl-style-spec`), `next`, `react-dom`, country-coder or any Node built-in. It may not use `@/*` (which means a different `src` in each app), and may not climb out of the folder. The climb-out rule is written once per folder depth (`shared/*`, `shared/*/*`, `shared/*/*/*`), because a later override replaces options rather than merging them. A file deeper than three levels needs a depth added. Everything outside `shared/` is the web app's alone. In particular, `src/lib/map/index.ts` reads `window.location` at module load.

## Commands

### Working on code

- `npm run dev` (Turbopack). **Don't run `npm run build` unless asked.**
- `npx tsc --noEmit`: **run after every batch of changes**.
- `npm run lint` (Biome: formatter + linter): **all code must conform**, so run it and fix findings before calling a change done. Use `npm run lint:fix` for fixes. **Never blanket-apply `--unsafe`**, because the `useExhaustiveDependencies` autofix mangles intentional dependency arrays. Fix hook deps by hand, or add `// biome-ignore lint/correctness/useExhaustiveDependencies: <reason>`.
- `npm test`: `node:test` through tsx, `tests/*.test.ts`, no framework. They cover the pure logic where a mistake is silent (coverage, the planner, chain merging, the GeoJSON stream, layer prefs, selection…), so run them after touching `src/lib` or `src/scripts/lib`. Tests live in `tests/` because the shared folder can't import `node:test`, and import through `@/`. The `*.sql.test.ts` files need the database and skip themselves without it.

### Data pipeline and database (details in `src/scripts/CLAUDE.md`, `osmium-scripts/CLAUDE.md`)

- `docker-compose up -d db`: start Postgres+PostGIS.
- `npm run prepareMapData -- [extract ...]`: OSM → `data/pruned.geojson` (all regions in one file). Naming extracts builds `data/pruned-partial.geojson`.
- `npm run importMapData <file> [...]`: load stations + railway_parts, **replacing the whole map**, all-or-nothing. Then recalculate routes (`--valid-only`, `--concurrency=N`, default 4).
- `npm run verifyRouteData`: recalculate all routes, then scenic lines, marking invalid ones (`--valid-only`, `--concurrency=N`).
- `npm run applyVectorTiles`: re-apply `database/init/02-vector-tiles.sql`.
- `npm run markAllRoutesInvalid`: flag all routes for recheck. **The reference example for migration scripts.**
- `npm run fixSequences`: resync SERIAL sequences ("duplicate key violates …_pkey" after rows were loaded with explicit ids).
- `npm run createAdmin -- <email> [name] [--reset]`: create the admin (user 1), prompting for the password (12+ chars, never an argument). **A setup step for every new database.** `--reset` replaces the admin's credentials and signs out all their sessions. On the server, run it from its checkout.
- `npm run inspectPath -- "<from>" "<to>" ["<via>"...] [--special]`: run the Journey Planner from the CLI and print the chain, the partial legs and the gaps.
- `npm run showBacktracking`: list routes that backtrack unintentionally, with OpenRailwayMap links. Read-only.
- `npm run listStations`: debug.

### Server data (run locally; the server only runs `pg_dump`)

- `npm run backupRouteData`: route data (everything not rebuilt from OSM, users included) → `data/backups/railway_data_<timestamp>.dump`.
- `npm run pullRouteData`: a backup, then replace the local route data with it. Local accounts become the server's. The geometry was computed against the server's map, so use `pullAllData` if the local map differs.
- `npm run pullAllData`: a backup, then map + route data from one snapshot (~450MB, ~1.5 min).
- `npm run restoreRouteData <file.dump>`: restore an earlier backup.

### Deploys

- **Map data**: `npm run deployMapData -- [--valid-only] [--concurrency=N] [--fresh] [--follow]` (`deployValidMapData` = `--valid-only`). It runs locally and does the work on the server. **It stops when the terminal session ends**; rerun to resume. It refuses while local commits are unpushed. Afterwards, **commit `osmium-scripts/deployed-extracts.txt`**. A new import flag goes in both `deploy.sh` and `remote-deploy.sh`.
- **App**: a push to `main` builds and redeploys (`.github/workflows/deploy.yml`), unless everything it touches is under `mobile/`, under `osmium-scripts/` or a `*.md`. Each deploy **re-applies `02-vector-tiles.sql`**, so keep it idempotent. It runs under `lock_timeout` 10s and fails rather than stalls while a map import holds the tables, so rerun it afterwards (`applyVectorTiles` on the server). `01-schema.sql` is never re-run, so schema changes are migration scripts. The `tiles` container is restarted when `martin/` changed (checksum on the server), because `up -d` alone keeps a dropped source published.
- **Martin and PostGIS are pinned by digest** in `docker-compose.yml`; bump the tag and digest together. Pushing a new `db` image _is_ the upgrade (Postgres restarts mid-deploy), so take `backupRouteData` first, and run `ALTER EXTENSION postgis UPDATE` afterwards if PostGIS moved. The `db` image stays **Alpine**: musl → glibc would reorder every text index.
- The server's runtime env (DB credentials, `JWT_SECRET`) is in `~/osm-trains/.env`, handed to compose with `--env-file`. A compose command run there by hand needs the same flag. `.dockerignore` keeps every `.env*` out of the image (Next's standalone output would copy it in).
- **Every published port is bound to `127.0.0.1`**. Caddy on the host proxies to 3000/3001, and a Docker-published port bypasses ufw (an exposed frontend lets a client set its own `X-Forwarded-For`).
- **A production server won't start without a `JWT_SECRET` of at least 32 bytes** (`resolveJwtSecret`, called from `src/instrumentation.ts`). The secret is resolved on first use, because `next build` runs as production with no secret. Only development falls back to a built-in key.

Prerequisites: Osmium Tool (`conda install conda-forge::osmium-tool`), Node, Docker, `tsx`, `.env` from `.env.example`.

## Data model (Postgres 18 + PostGIS 3.6)

Schema in `database/init/01-schema.sql`. What the columns don't tell you:
- **Type parsers** (`dbConfig.ts`, global to `pg`): NUMERIC arrives as a JS number, DATE as its `YYYY-MM-DD` string, and BIGINT as a string (OSM ids are handled as strings). Cast a `count(*)` to `::int` where it is read.
- **Every `pg` pool is made by `createPool`** (`db.ts`), which attaches the `error` listener. Without it, an idle connection dying takes the process down.
- `users.email` is stored `lower(btrim(...))`, folded in SQL on every write and lookup, and held there by a CHECK.
- `stations`: areas are reduced to their centroid under a **negated id**. `near_route` = a route within 250m (see "Routes").
- `railway_routes.usage_type`: **0 Regular** is in the official national timetable at any frequency. **1 Heritage & tourist** is a line of its own outside the national timetable (museum and rack railways, funiculars), drawn dotted. **2 Special** is national track used irregularly (diversions, festival or tourist runs), drawn dashed. 1 vs 2 is about whose track and whose timetable, not the kind of train. Service character (daily, seasonal) goes in `frequency` (free-form tags). 1 and 2 are left out of stats and planner unless the region counts them as ordinary (`ordinaryUsageTypes`).
- `line_class` is 'highspeed' | 'main' | 'branch'. It is classified automatically on create/edit by a length-weighted majority of intersecting parts (>50% highspeed, else >50% main, else branch), and the admin can override. Countries come from `countryAt` (country-coder) on the two click points.
- **Ownership is in the schema**: trips and journeys carry `UNIQUE (id, user_id)`, and the FKs into them are composite (`(trip_id, user_id)`, `(journey_id, user_id)`).
- `user_preferences.selected_countries`: every write goes through `updateSelectedCountriesForUser` → `normalizeCountryCodes`.
- `admin_notes.note_type`: only `Usage` is public. `UsageInternal` is an admin draft, promoted to `Usage` to publish.
- **A new table holding user data needs `ON DELETE CASCADE` on its `users` FK** (or it blocks account deletion) and a place in the route data backup (`serverData.ts`).

## Routes and their invariants

- A route is two exact click points on railway parts; its geometry is the path between them (`src/scripts/CLAUDE.md`). Recalculation after an OSM update reuses the points.
- **`mergeLinearChain`** (`coordinateUtils.ts`) stitches the path's parts. It joins sublists **only at their first/last coordinates** and takes them **in path order**; it must never work the order out itself. Callers catch "Chain is broken" and skip that combination. **Invalid** = no path, off-network, or a >0.1km AND >1% length mismatch → `is_valid=false` + `error_message`. Invalid routes are drawn grey on the admin map, and "Edit Geometry" re-picks the points.
- **`under_repair` never outlives invalidity.** It marks an invalid route as only temporarily broken in OSM. It is admin-set (`setRouteUnderRepair`, refused on a valid route), drawn violet, and has its own admin filter disjoint from "Invalid". Every path that marks a route valid clears it (a geometry re-pick in `adminRouteActions`, a successful recalculation). Failed recalculations and metadata saves leave it.
- **Station proximity** (`stationProximity.ts`): `near_route` gates `public_stations_tile`, `searchStations` and `inspectPath`'s name lookup. The admin map shows every station. **Every write that moves route geometry must refresh it**: `refreshAllStationProximity` after a bulk pass, `refreshStationProximityFor` in `saveRailwayRoute`/`deleteRailwayRoute`. An edit or delete also calls `getStationsNearRoute` **before** the write, since afterwards the stations that lost their last route can't be found. A duplicate needs nothing.
- **Duplicating a route clones every user's logs, on purpose** (`duplicateRailwayRoute`). Duplication exists to split A–C into A–B and B–C, and everyone who rode A–C rode both. `reprojectCoveredRanges` in `saveRailwayRoute` carries a partial ride through the re-pick. A duplicate left un-split double-counts.
- **Scenic lines** are their own table, drawn and recalculated exactly like routes, but they carry only From/To and are used for highlighting alone. Nothing is logged against them or derived from them (no `near_route`, planner or stats). An invalid one keeps its last geometry. **A scenic line never backtracks**: its preview, save and recalculation all search with `avoidBacktracking` (`findAdminPath`), a save re-finds the path from the points and refuses one that still backtracks, and a recalculation that does marks the line invalid.
- Every stored `length_km` and the admin preview use one expression, `lineLengthKmSql` (`lineLength.ts`).

## Regions (`src/lib/shared/regions.ts`)

Europe and Japan are two views of one backend. A region is a **bounding box**: the map's `maxBounds`, and the filter in every query that must not leak the other network. Filter always through `regionContainsSql(region, point)` with a **point** column, never a line. There is no `region` column. The user map's routes need no bbox, because the `selected_countries` tile filter already separates the regions. A journey belongs to a region when it logged a route there, a trip when any of its journeys did; one with no routes yet belongs to every region. Region-scoped endpoints take the region explicitly.

**Per-region flags keep the differences declarative. Never write `region.id === "japan"`.**
- **`hasRouteNames`** (Japan): every route carries a line name, which leads its title everywhere (`routeTitle`). The map search also searches lines. Lines and stations are searched by **one** server action (`searchMap`, the admin's `searchAdminMap`, both over `searchMapByName`), because Next runs a client's server actions one at a time.
  - **A route can be on several lines** (`other_names`, "Also part of"): where named lines share a stretch, it is one route, ridden and counted once. `name` is the line it is called by. It is the admin's choice and never derived. Line membership always goes through `lineMembership.ts` (`routeLinesSql`, `onLineSql`), **never `name` alone**. Other names need a `name` (CHECK), and `routeLineNames` drops any that equal the name or another once folded (`foldForSearch`). Parallel _tracks_ of different kinds stay separate routes.
- **`hasScenicHighlight`**: the user map's scenic toggle and the admin's Scenic tab.
- **`hasCountryFilter: false`** (a one-country region): hides the country list and pins the filter.
- **`usageLabels`**: usage types the region renames (Japan: Regular "JR line", Special "Non-JR line"). Everything user-facing goes through `regionUsageLabel` / `regionUsageOptions` / `regionUsagePluralLabel`.
- **`ordinaryUsageTypes`**: the types that are ordinary timetabled service. Europe `[0]`, Japan `[0, 2]`, Heritage never. It drives progress (`ordinaryUsageSql`, `countedUsageTypes`), the per-type rows in Map & Stats (`hasOrdinaryNonRegular`), the planner's "Include …" switch (`ordinaryRouteSql`) and the Special layer's default.

The selected region lives in a cookie (`REGION_COOKIE`), read by server components for a correct first paint. On the client it comes from `useRegion`/`useRegionId` (`regionContext.tsx`). **Switching clears everything picked in the old region**: selection and highlights, the planner form, the admin's selection and geometry pick, the logger's picked trip. Saved map position is per region.

## Progress and partial rides

- A route counts as **completed** if it was logged with `partial=false` in any journey, **or if its partial stretches add up to the whole line**. Otherwise it is partial. The country filter requires BOTH endpoints in the selected list. Only `ordinaryUsageTypes` count. The map's progress box is further narrowed to the types the map shows, except on the shared map.
- **"Ridden whole" is one rule in two implementations** (`shared/routeCoverage.ts`). Widen each logged stretch by `UNTRAVELLED_NOISE_KM` (0.3km, capped at a quarter of the route) at both ends, union them, and test for [0,1]. Stretches of unknown extent are excluded. The server's version is SQL `user_fully_ridden_routes` (see `database/CLAUDE.md`). `isRouteFullyRidden` mirrors it for localStorage users, fed by `getRouteSummaries` (no geometry: with it the list is ~50MB for Europe). Change both together, and run `tests/routeCoverage.sql.test.ts`.
- **A partial ride is a fraction range**: `covered_start`/`covered_end` in `ST_LineLocatePoint` space along the route geometry. Both NULL means the extent is unknown (logged whole, or ticked partial by hand). The range is cut on read with `ST_LineSubstring` (`getCoveredStretches`) and **never simplified**. Only the Journey Planner produces a range, and it is dropped on write unless `partial` is set (`sanitizeRange`). Rows for one route are never merged.

## Auth and security

- Email/password + bcrypt + session cookie. Anonymous users get localStorage (`localStorage.ts`, imported as `localStore`) behind the `dataAccess.ts` abstraction, migrated on login (`migrationActions.ts`).
- **A signed token is not enough; the account has to agree.** A token is refused if it was issued before the user's `password_changed_at` or if the user is gone. The rule is written once, as SQL (`currentAccountIdSql`, `sessionQueries.ts`). `authTokens.ts` only reads tokens and never touches the database. `verifyToken` applies the rule for the cookie, the bearer and the refresh; the tile handlers embed it in the tile query. **Anything that sets a password must set `password_changed_at = now()` beside it.**
- **The web session slides.** The cookie lasts 90 days, and `POST /api/session` re-issues it once it is a day old. `useSessionKeepAlive` calls it as a signed-in page loads and whenever it comes back into view, and shows "Signed out" when the session is gone or belongs to another account. It is a route handler because a server action that sets a cookie re-renders the page. **A renewal goes through `verifySession` first**: a fresh token minted from a signature check alone would outlive a password change.
- **A password check is capped and costs the same on every path.** An unknown email compares against `ABSENT_USER_HASH`. `rateLimit.ts` allows 10 sign-ins per 5 minutes (account deletion's password check counts as one) and 5 registrations per hour, held in memory. It is keyed on the **client address only, never the email**. The address is the rightmost `X-Forwarded-For` hop, never `X-Real-IP`, and IPv6 is keyed by its /64. **Every attempt counts, successes included.** The limit is enforced on both transports.
- **Account deletion** re-checks the password, then deletes the `users` row; everything the user owns cascades from it. Refused for user 1.
- **Admin = user_id 1** (reserved). Every admin server action is `return asAdmin(async () => …)` (`authHelpers.ts`).

## Two transports, one set of queries

User-scoped queries live in plain server-only modules taking a `userId` (`progressQueries.ts`, `journeyQueries.ts`, `tripQueries.ts`, `preferencesQueries.ts`, plus the user-less `routeQueries.ts`, `authQueries.ts`, `routePathFinder.ts`). Three thin callers resolve who is asking and delegate: the `*Actions.ts` modules (session), `publicMapActions.ts` (share token), and the `src/app/api/v1` handlers (bearer, for the native app only; see `API.md`).
- **A route handler never imports a `"use server"` module, and a query taking a user id is never exported from one.** Every export of a `"use server"` file is a client-callable endpoint. Where a needed query sits inside an action, lift it out. Shared input checks for the admin actions live in `adminValidation.ts` for the same reason.
- **Errors**: queries throw `ValidationError` (→ 400), `NotFoundError` (→ 404) or `RateLimitError` (→ 429, with `Retry-After`) from `errors.ts`. Anything else is an opaque 500, so no Postgres text reaches a client. A production build replaces the message of anything thrown out of a server function, so actions wrap with `asActionResult` to _return_ `{ error }` (`asUser` / `asAdmin` apply it). The client re-throws with `unwrap` and shows the error through `actionErrorMessage(error, fallback)`. **A Biome GritQL plugin** (`biome-plugins/unwrapActions.grit`) requires every call into `@/lib/admin*Actions`, `journeyActions` or `tripActions` to be `unwrap(await action(…))` or `action(…).then(unwrap)`. When editing the plugin, look imports up among the module's top-level items (`$program <: JsModule(items=$items)`), never with `$program <: contains` (lint goes from 2s to 19s).
- `/api/v1`: bearer auth with the same secret as the cookie, which a handler never reads. `region` is explicit everywhere and **never defaults**.

## Vector tiles and sharing

Martin (port 3001) serves `railway_routes_tile` (`selected_countries` filter, no user), `railway_parts_tile`, `stations_tile` (every station, admin map), `public_stations_tile` (`near_route` only, user map), `public_notes_tile` (`Usage` notes, text + source only) and `scenic_lines_tile`.
- **Nothing Martin publishes may depend on who is asking.** Martin answers anyone, with no session in sight.
- **`railway_routes_mvt`, the tile coloured by someone's rides, must never be added to `martin/configuration.yml`.** It is served by `api/tiles/railway_routes/[z]/[x]/[y]`, which resolves whose rides on every tile: `?share=<token>` (only while sharing is on), else a bearer token, else the session cookie. A missing or dead credential is a 401/404, never an uncoloured tile that would pass for an unridden map. The client never names a user (`createRailwayRoutesSource({ rides: "session" | { shareToken } })`).
- **`admin_notes_tile` is kept out of Martin too**: `api/tiles/admin_notes/...` checks the admin session on every tile. These two and `api/session` are the only route handlers that read the cookie (`lib/api/tiles.ts`), and they gzip through `mvtResponse` (Next won't compress protobuf).
- **Public map sharing** (`/shared/<token>?view=<region>`): the token is minted on the first read of the settings and never changes, and `public_map_enabled` alone grants access. Every public read, every route tile included, re-resolves the token through `sharedMapOwnerIdSql`, so switching sharing off stops an open map at once. `?view=` wins over the visitor's region cookie. On the client the shared view is a third `DataAccess` whose preference write throws.

## Conventions

- **Journey dates** always go through `formatDateOnly` / `formatDateOnlyRange` (`shared/getUntimezonedDateStr.ts`). Never `new Date("YYYY-MM-DD")`, which is UTC midnight and prints the day before west of UTC.
- **Search folding**: `foldForSearch` (`searchText.ts`) drops case, diacritics and separators exactly as SQL `search_key` does, so "owariseto" finds "Owari Seto". `foldAccents` keeps separators, for the frequency tags, where "1-2x" is not "12x".
- **Distance in SQL**: never `ST_DWithin` on a `::geography` cast. Use `withinMetersSql` (`mercatorDistance.ts`).
- **No `["all", ...]` in a data-driven paint expression**, in either app. MapLibre Native crashes on it (details in `src/lib/shared/map/CLAUDE.md`).
- **Installable app** (a web app made installable, not the native app): `src/app/manifest.ts` (`display: "standalone"`). `theme-color` is written by `THEME_INIT_SCRIPT`, not by Next's metadata, because the scheme is a setting. **`public/sw.js` caches no HTML and no data**: only `/_next/static/` (cache-first, capped at 150 entries) and `/maplibre/` (stale-while-revalidate), never cross-origin. It is served `no-store` and registered in production only; in development `ServiceWorkerRegistrar` unregisters leftovers.

@AGENTS.md
