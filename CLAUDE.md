# CLAUDE.md

Guidance for Claude Code working in this repo.

## Overview

Unified Next.js app for OSM railway data: fetches, processes, and visualizes railway data for 20 European countries (see `SUPPORTED_COUNTRIES` in `src/lib/constants.ts`). Single `package.json`, single `.env`, one container. Data processing scripts live alongside the web app under `src/`.

## Core Commands

### Data pipeline
- `npm run prepareMapData -- <YYMMDD>` — download OSM, filter rail, convert to GeoJSON, prune. Output: `./data/europe-pruned-<version>.geojson`.
- `npm run importMapData <filepath>` — load GeoJSON into Postgres (stations + railway_parts). Auto-recalculates existing routes; skips recalculation on initial load. Add `--valid-only` to recalculate only routes not already marked invalid.

### Database ops
- `docker-compose up -d db` — start Postgres+PostGIS.
- `npm run verifyRouteData` — recalculate all routes, mark invalid ones.
- `npm run applyVectorTiles` — re-apply `database/init/02-vector-tiles.sql`.
- `npm run markAllRoutesInvalid` — flag all routes for recheck (use `verifyRouteData` after). **Reference example for migration scripts.**
- `npm run fixSequences` — resync all SERIAL id sequences with table data. Fixes "duplicate key violates …_pkey" on inserts after rows were loaded with explicit ids (old dumps) without bumping the sequence. `importRouteData` now does this automatically; run manually if needed.
- `npm run listStations` — list unique station names (debug).
- `npm run inspectPath -- "<from>" "<to>" ["<via>"...]` — run the Journey Planner pathfinder from the CLI (station names or ids) and print the chain, search time, and the gap left between each consecutive pair of routes (debug).
- `npm run exportRouteData` / `npm run importRouteData <file>` — pg_dump/psql via `docker exec`; covers `railway_routes`, `user_trips`, `user_journeys`, `user_logged_parts` (user_id=1), `admin_notes`. Output to `data/railway_data_YYYY-MM-DD.sql`.

### Data transfer (pscp)
- `npm run deployMapData` / `npm run downloadMapData` / `npm run downloadRouteData`.
  - `deployMapData` accepts an optional date (YYMMDD) and an optional `--valid-only` flag (any order, e.g. `npm run deployMapData -- 260523 --valid-only`). `--valid-only` forwards to the remote `importMapData`, which only recalculates routes that aren't already invalid (`is_valid IS NOT FALSE`) — useful to skip routes that will fail recalc anyway. `importMapData` and `verifyRouteData` also accept `--valid-only` directly.

### Frontend
- `npm run dev` (Turbopack), `npm run build`, `npm run start`.
- `npm run lint` (Biome check — formatter + linter), `npm run lint:fix` (apply safe fixes), `npm run format` (format only). **All code must conform to Biome** (config in `biome.json`); run `npm run lint` and resolve findings before considering a change done.
- `npx tsc --noEmit` — **always run this after a batch of code changes**. Do not run full builds unless the user asks.

### Prerequisites
Osmium Tool (`conda install conda-forge::osmium-tool`), Node, Docker, `tsx` (for TS scripts), `.env` copied from `.env.example`.

## Architecture

### Data flow
`OSM PBF → filtered OSM → GeoJSON → pruned GeoJSON → Postgres → Martin (MVT tiles) → MapLibre`

### Database (Postgres 16 + PostGIS)

Spatial data uses GIST indexes. Web Mercator (EPSG:3857) geometry columns synced via triggers. Tables:

- **users** — auth (email username, bcrypt password).
- **stations** — Point features from OSM.
- **railway_routes** — SERIAL `track_id`, `from_station`, `to_station`, `description`, `usage_type` (0=Regular, 1=Heritage, 2=Special; 1 & 2 are non-regular — excluded from stats/planner. Regular = in the official national timetable at any frequency; Heritage = museum/preserved operation outside timetables, drawn dotted; Special = national tracks used irregularly — diversions, festival/anniversary/tourist runs — drawn dashed. Each non-regular type has its own user-map toggle and its own line layer — Regular solid (`railway_routes`), Heritage dotted (`railway_routes_heritage`), Special dashed (`railway_routes_special`) — because `line-dasharray` isn't data-driven), `frequency` TEXT[] (free-form tags, GitLab-labels style — no fixed list, no separate tag table; a tag exists only while some route uses it. `getFrequencyTags` returns the distinct in-use set for the `TagInput` autocomplete), `link`, `scenic` BOOL, `line_class` ('highspeed'|'main'|'branch', auto-classified on create/edit, manually overridable), PostGIS `geom`, `length_km`, `start_country`/`end_country` (ISO 3166-1 alpha-2), `starting_coordinate`/`ending_coordinate` (POINT — exact click points for recalculation), `is_valid`, `error_message`, `intended_backtracking`, `has_backtracking`.
- **railway_parts** — raw OSM segments; includes `usage` (main/branch/industrial/tourism) and `highspeed` BOOL.
- **user_trips** — id, user_id, name (req), description, timestamps. Groups journeys.
- **user_journeys** — id, user_id, name (req), description, date (req), `trip_id` FK ON DELETE SET NULL, timestamps.
- **user_logged_parts** — id, user_id, journey_id, `track_id` FK ON DELETE CASCADE, `partial` BOOL, created_at. UNIQUE per (journey_id, track_id).
- **user_preferences** — `selected_countries` TEXT[]. Defaults to all of `SUPPORTED_COUNTRIES` (20 codes); `getUserPreferences()` always writes the list explicitly, so the SQL column DEFAULT only matters for rows inserted directly via SQL.
- **admin_notes** — id, coordinate POINT, text, `note_type` ('Usage'|'UsageInternal'|'Works'|'Todo', nullable for legacy), `source` (optional external link), timestamps. Only `note_type='Usage'` notes are public (shown on the user map); `UsageInternal` is an admin-only draft promoted to `Usage` to publish. `noteTypeOptions`/`isPublicNoteType` in `constants.ts`.

### Key architectural decisions

- **Coordinate-based routing.** Routes are defined by exact start/end POINTs (click positions on railway parts). Pathfinding (`RailwayPathFinder`) finds which parts contain each coordinate (1m tolerance — parts are matched against the exact stored click point), truncates edge parts to the click point, and stitches via `mergeLinearChain`. The primary search is BFS by hop count; a distance-weighted search is used only when the shortest path backtracks and a non-backtracking alternative is sought. Recalculation after OSM updates uses the stored coordinates.

  `mergeLinearChain` joins sublists **only at their first/last coordinates**, matching how `coordToPartIds` builds adjacency. Two OSM ways can share a node mid-way, and accepting such a match would splice in a segment that doesn't start at the chain's tail — silently producing a geometry with a jump. Callers catch the resulting "Chain is broken" and skip that part combination.
- **Route invalidation.** Routes that can't recalculate (no path, off-network, or >0.1km AND >1% length mismatch) get `is_valid=false` and an `error_message`. Shown in grey on admin map; admin "Edit Geometry" re-picks coordinates.
- **Auto line classification.** On route create/edit, length-weighted majority of intersecting railway_parts: >50% highspeed→'highspeed', >50% main→'main', else 'branch'. Admin can override.
- **Country detection.** `@rapideditor/country-coder` on first/last coordinate fills `start_country`/`end_country`.
- **Vector tiles** via Martin (port 3001): `railway_routes_tile` (accepts `selected_countries` filter), `railway_parts_tile` (zoom-filtered), `stations_tile` (zoom 10+), `admin_notes_tile` (all notes, admin map), `public_notes_tile` (`note_type='Usage'` only, exposes just text+source — user map).
- **Progress.** A route counts as completed if logged with `partial=false` in any journey; partial if only `partial=true`. Country filter requires BOTH start and end country in selected list.
- **Auth.** Email/password + bcrypt + session. Unauthenticated users get localStorage (`localStorage.ts` module functions, imported as `localStore`) via `dataAccess.ts` abstraction; `migrationActions.ts` migrates on login.
- **Admin = user_id=1.** Every admin server action enforces this check.

### Journey planner pathfinding

`routePathFinder.ts` searches over **whole routes**, not OSM parts: nodes are `(track_id, exit endpoint)` pairs and edges join routes whose endpoints are within `ENDPOINT_TOLERANCE_METERS` (500m). Dijkstra with a binary heap; cost is `length_km × line_class multiplier` (highspeed 0.5, main 1.0, branch 2.0) plus a gap penalty, and the first end route popped wins.

- **State includes the exit endpoint**, so a route is entered at one end and left at the other. Without that, paths teleport from one end of a route to the other.
- **Entry side = the nearer endpoint.** Taking the first endpoint within tolerance instead makes any route shorter than the tolerance one-way only, which made the sub-kilometre connectors inside junction complexes unusable.
- **`GAP_PENALTY_PER_KM` (25) charges for the gap left at each connection.** Endpoints are hand-picked click points, so routes that really meet still land some metres apart — but a junction complex packs several distinct endpoints a few hundred metres apart, all inside the tolerance. Untaxed, the search jumps between them and skips the short route that actually covers the gap. Genuine data offsets of a few tens of metres are cheap; a 500m jump costs 12.5 km-equivalent, so it only happens when nothing covers it. `npm run inspectPath` prints these gaps — tens of metres is normal, hundreds means something was skipped.
- **The whole network is loaded at once** (endpoints only, ~4.7k regular routes) and endpoints are bucketed into a spatial grid for pairing. There is no buffering around the stations; the search used to retry with 50km→1000km buffers, rebuilding the graph each time a segment failed.
- **The built graph is cached in memory** (`getRouteGraph`), keyed on a `count(*)`/`max(updated_at)` fingerprint of `railway_routes`. Extracting endpoints costs ~450ms because every `ST_PointN` walks the full linestring, so a cache miss is the dominant cost of a search; every route write path bumps `updated_at`, so edits invalidate it.
- **Station → routes** is one indexed query for all of from/via/to, then progressive tolerance (100m→5km, extended one level up) applied in memory. Never use `ST_DWithin` on a `::geography` cast here — it can't use the geometry index and costs ~860ms per call; go through `geometry_3857` with 1/cos(lat) radius scaling.

### Map styling

`src/lib/map/style.ts` is the **single source of truth** for colors/widths/opacities (`COLORS`, `WIDTHS`, `CIRCLES`, `OPACITIES`). Route colors come from visit status × line_class (green/orange/red, darker for highspeed). Width is a single z4→z7 zoom interpolate; all line classes visible at all zooms, just thinner when zoomed out. Scenic routes get an amber outline (its own layer because MapLibre forbids wrapping a zoom-interpolate). An invisible wide `railway_routes_click` layer sits over the visible line for touch hit areas. Hover popups use badge formatting from `utils/tooltipFormatting.ts`.

**Popups are raw HTML strings passed to MapLibre's `setHTML`, so nothing is escaped for you.** Every interpolated value must go through `escapeHtml()`, and every URL through `safeHref()` (both in `utils/tooltipFormatting.ts`); `safeHref` returns `""` for anything that isn't `http(s)`, which also guards the `window.open` double-click handlers. This is not just about admin-authored text — **station names come straight from OSM**, i.e. from a third party who can edit them.

Selection/highlight layers:
- Route Logger selection: orange `#ff6b35` overlay (same as admin selected-route style).
- Journey Planner result: gold `#FFD700`.
- My Trips browsing: orange.

## Code structure

### Routes (`src/app/`)
- `page.tsx` — main map (server component → MainLayout).
- `admin/page.tsx` — admin route mgmt (user_id=1 only).

### Components (`src/components/`)
- **User map**: `MainLayout`, `VectorRailwayMap`, `UserSidebar` (tabs + article views), `JourneyLogger` (auth), `LocalTripLogger` (unauth), `JourneyPlanner`, `JourneysAndTripsTab`, `MergedTripCard`, `MergedJourneyCard`, `LocalJourneyLogTab`, `CountriesStatsTab`, `HowToUseArticle`, `RailwayNotesArticle`.
- **Admin**: `AdminPageClient`, `VectorAdminMap`, `AdminLayerControls`, `AdminSidebar`, `AdminCreateRouteTab`, `AdminRoutesTab`, `RoutesList`, `RouteEditForm`, `NotesPopup`.
- **Shared**: `Navbar`, `MobileMenuPanel`, `LoginForm`, `RegisterForm`.

### Library (`src/lib/`)
- **DB/actions**: `db.ts`, `dbConfig.ts`, `userActions.ts`, `userPreferencesActions.ts`, `journeyActions.ts`, `tripActions.ts`, `adminRouteActions.ts`, `adminMapActions.ts`, `adminNotesActions.ts`, `authActions.ts`, `migrationActions.ts`.
- **Data access**: `dataAccess.ts` (DB vs localStorage abstraction), `localStorage.ts`.
- **Pathfinding**: `routePathFinder.ts` (user-facing journey planner, excludes non-regular routes). See "Journey planner pathfinding" below.
- **Utils**: `types.ts`, `constants.ts`, `coordinateUtils.ts` (`mergeLinearChain`, `coordinatesToWKT`), `countryUtils.ts`, `getUntimezonedDateStr.ts`.
- **Toast**: `toast/` (`useToast`, `ToastContainer`, `ConfirmDialog`).

### Map library (`src/lib/map/`)
- `index.ts` — constants, layer/source factories, `lineClassColorExpression`. Re-exports from `style.ts`.
- `style.ts` — styling source of truth (see above).
- `mapState.ts` — save/load map position.
- **Hooks**: `useMapLibre`, `useRouteEditor`, `useStationSearch`, `useRouteLength`, `useAdminLayerVisibility`, `useAdminMapOverlays`, `useAdminNotesPopup`, `useMapTileRefresh`, `useRouteHighlighting` (takes `kind: 'planner' | 'view'`), `useLayerFilters`.
- **Interactions**: `userMapInteractions.ts`, `adminMapInteractions.ts`.
- **Utils**: `userRouteStyling.ts` (`getUserRouteWidthExpression`, `getUserRouteClickBufferWidthExpression`, `getUserRouteScenicOutlineWidthExpression`, `getAdminRouteWidthExpression`), `tooltipFormatting.ts` (badges + `escapeHtml`/`safeHref`), `distance.ts`.

### Scripts (`src/scripts/`)
- **Data**: `pruneData.ts`, `importMapData.ts`, `verifyRouteData.ts`, `applyVectorTiles.ts`, `markAllRoutesInvalid.ts` (migration reference), `fixSequences.ts` (resync SERIAL sequences), `listStations.ts`, `inspectPath.ts` (journey-planner debug), `exportRoutes.ts`, `importRoutes.ts`.
- **Shared**: `lib/loadRailwayData.ts`, `lib/railwayPathFinder.ts` (admin route creation + recalc).

### Database (`database/init/`)
- `01-schema.sql` — tables, indexes, validity/country/line_class columns.
- `02-vector-tiles.sql` — MVT tile functions, Web Mercator geom columns, sync triggers.

### OSM scripts (`osmium-scripts/`)
- `prepare.sh` — unified download/filter/convert pipeline.

## UI structure

### Sidebar (main map)
Desktop: resizable left sidebar (400–1200px, default 600px). Mobile: top-half drawer (`h-1/2`) toggled by navbar hamburger; map fills bottom half. Tabs: **Route Logger**, **My Trips** (auth) / **My Journeys** (unauth), **Country Settings & Stats**. Article views: **How To Use**, **Railway Notes** (full-screen with close button). `activeTab` lives in `MainLayout`, flows down via props (no useEffect sync). Map route/station clicks only active in Route Logger tab.

### Route Logger
Click routes on map to add to selection; click stations to fill Journey Planner (focused field, else from→to). Per-route partial toggle + remove. "Log Journey" creates a new journey with name (req), description, date (defaults today). Embedded Journey Planner: from/via*/to with drag-and-drop reordering, diacritic-insensitive autocomplete (requires PG `unaccent`), gold highlight of found routes, "Add Routes to Selection".

### My Trips / My Journeys (auth)
`JourneysAndTripsTab` — paginated (10/page, server-side via `getJourneysAndTrips(page, pageSize, search)`), debounced search (300ms). Top-level rows are either a trip (with nested journeys) or a standalone journey. Sorted by effective date desc (trip = MAX(journey.date)). Single-open coordination: one top-level card at a time, plus one nested journey edit. Map highlights: open trip shows all its journeys' routes; open journey shows only its routes.

Trip stats (`route_count`, `total_distance`) come from the shared `TRIP_STATS_SELECT` in `tripActions.ts`, used by both `getAllTrips` and `getJourneysAndTrips`. Journey and route stats are aggregated in **separate subqueries**: joining `user_journeys × user_logged_parts` directly fans out, so a route ridden on two days of one trip would be double-counted. Both the count and the distance are taken over `DISTINCT (trip_id, track_id)` — a route counts once per trip, so "N routes · X km" always refer to the same set.

### Country Settings & Stats
All 20 `SUPPORTED_COUNTRIES` with flag emojis (Unicode regional indicators). Select All / None. Per-country stats via `getProgressByCountry()` (matches when both endpoints in country) — one `GROUPING SETS` query covering every country plus the grand total, not a query per country. Persisted in `user_preferences`. Filter applies to map + stats; **admin map ignores it**.

### Admin
Click railway part → capture exact coordinate for start/end. Right-click anywhere → create note; right-click existing note → edit/delete. Note popup: type (req), text, optional source link, save (Ctrl+Enter), delete, close (Esc). Notes are colored by type on the admin map (`Usage`=blue, `UsageInternal`=light blue, `Works`=orange, `Todo`=purple); `AdminNotesTab` filters by type and lets you switch a note's type (= publish/unpublish). Only `Usage` notes appear on the user map (hover popup shows text + source link). Invalid routes in grey with banner; "Edit Route Geometry" re-picks coordinates with same pathfinding.

## Development workflow

### Database migrations
When changing schema or transforming existing data, create a TS script in `src/scripts/`. Pattern: import `pool` from `@/lib/db`, run SQL, log progress, exit. Use `markAllRoutesInvalid.ts` as the reference. Register in `package.json` and document in this file's Database Operations + Scripts sections.

### Type checking
Run `npx tsc --noEmit` after each batch of related changes. Don't run full builds unless asked.

### Linting & formatting
Biome is the single linter + formatter (`biome.json`). All code must conform — run `npm run lint` and fix findings before finishing. Use `npm run lint:fix` for safe autofixes, but **never blanket-apply `--unsafe`**: Biome's `useExhaustiveDependencies` autofix mangles intentional hook dependency arrays (drops trigger deps, adds recreated-every-render objects → infinite loops). Fix hook-deps findings by hand — memoize with `useCallback`/`useMemo`, or add a `// biome-ignore lint/correctness/useExhaustiveDependencies: <reason>` comment when the omission is intentional.

### TypeScript
ESNext modules, strict mode, run scripts via `tsx`.
