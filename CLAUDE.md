# CLAUDE.md

Guidance for Claude Code working in this repo.

## Overview

Unified Next.js app for OSM railway data: fetches, processes, and visualizes railway data (Czechia, Slovakia, Austria, Poland, Germany, Baltics). Single `package.json`, single `.env`, one container. Data processing scripts live alongside the web app under `src/`.

## Core Commands

### Data pipeline
- `npm run prepareMapData -- <YYMMDD>` — download OSM, filter rail, convert to GeoJSON, prune. Output: `./data/europe-pruned-<version>.geojson`.
- `npm run importMapData <filepath>` — load GeoJSON into Postgres (stations + railway_parts). Auto-recalculates existing routes; skips recalculation on initial load.

### Database ops
- `docker-compose up -d db` — start Postgres+PostGIS.
- `npm run verifyRouteData` — recalculate all routes, mark invalid ones.
- `npm run applyVectorTiles` — re-apply `database/init/02-vector-tiles.sql`.
- `npm run markAllRoutesInvalid` — flag all routes for recheck (use `verifyRouteData` after). **Reference example for migration scripts.**
- `npm run listStations` — list unique station names (debug).
- `npm run exportRouteData` / `npm run importRouteData <file>` — pg_dump/psql via `docker exec`; covers `railway_routes`, `user_trips`, `user_journeys`, `user_logged_parts` (user_id=1), `admin_notes`. Output to `data/railway_data_YYYY-MM-DD.sql`.

### Data transfer (pscp)
- `npm run deployMapData` / `npm run downloadMapData` / `npm run downloadRouteData`.

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
- **railway_routes** — SERIAL `track_id`, `from_station`, `to_station`, `track_number`, `description`, `usage_type` (0=Regular, 1=Special), `frequency` TEXT[] (Daily/Weekdays/Weekends/Once a week/Seasonal), `link`, `scenic` BOOL, `line_class` ('highspeed'|'main'|'branch', auto-classified on create/edit, manually overridable), PostGIS `geom`, `length_km`, `start_country`/`end_country` (ISO 3166-1 alpha-2), `starting_coordinate`/`ending_coordinate` (POINT — exact click points for recalculation), `is_valid`, `error_message`, `intended_backtracking`, `has_backtracking`.
- **railway_parts** — raw OSM segments; includes `usage` (main/branch/industrial/tourism) and `highspeed` BOOL.
- **user_trips** — id, user_id, name (req), description, timestamps. Groups journeys.
- **user_journeys** — id, user_id, name (req), description, date (req), `trip_id` FK ON DELETE SET NULL, timestamps.
- **user_logged_parts** — id, user_id, journey_id, `track_id` FK ON DELETE CASCADE, `partial` BOOL, created_at. UNIQUE per (journey_id, track_id).
- **user_preferences** — `selected_countries` TEXT[] (defaults: CZ, SK, AT, PL, DE, LT, LV, EE).
- **admin_notes** — id, coordinate POINT, text, timestamps.

### Key architectural decisions

- **Coordinate-based routing.** Routes are defined by exact start/end POINTs (click positions on railway parts). Pathfinding (`RailwayPathFinder`, weighted Dijkstra) finds which part contains each coordinate (50m tolerance), truncates edge parts to the click point, and stitches via `mergeLinearChain`. Recalculation after OSM updates uses the stored coordinates. Cost multipliers: highspeed=0.5x, main=1.0x, branch=2.0x.
- **Route invalidation.** Routes that can't recalculate (no path, off-network, or >0.1km AND >1% length mismatch) get `is_valid=false` and an `error_message`. Shown in grey on admin map; admin "Edit Geometry" re-picks coordinates.
- **Auto line classification.** On route create/edit, length-weighted majority of intersecting railway_parts: >50% highspeed→'highspeed', >50% main→'main', else 'branch'. Admin can override.
- **Country detection.** `@rapideditor/country-coder` on first/last coordinate fills `start_country`/`end_country`.
- **Vector tiles** via Martin (port 3001): `railway_routes_tile` (accepts `selected_countries` filter), `railway_parts_tile` (zoom-filtered), `stations_tile` (zoom 10+), `admin_notes_tile`.
- **Progress.** A route counts as completed if logged with `partial=false` in any journey; partial if only `partial=true`. Country filter requires BOTH start and end country in selected list.
- **Auth.** Email/password + bcrypt + session. Unauthenticated users get localStorage (`LocalStorageManager`) via `dataAccess.ts` abstraction; `migrationActions.ts` migrates on login.
- **Admin = user_id=1.** Every admin server action enforces this check.

### Map styling

`src/lib/map/style.ts` is the **single source of truth** for colors/widths/opacities (`COLORS`, `WIDTHS`, `CIRCLES`, `OPACITIES`). Route colors come from visit status × line_class (green/orange/red, darker for highspeed). Width is a single z4→z7 zoom interpolate; all line classes visible at all zooms, just thinner when zoomed out. Scenic routes get an amber outline (its own layer because MapLibre forbids wrapping a zoom-interpolate). An invisible wide `railway_routes_click` layer sits over the visible line for touch hit areas. Hover popups use badge formatting from `utils/tooltipFormatting.ts`.

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
- **Pathfinding**: `routePathFinder.ts` (user-facing journey planner, station-name-based, progressive 50km→1000km buffer, excludes special routes).
- **Utils**: `types.ts`, `constants.ts`, `coordinateUtils.ts` (`mergeLinearChain`, `coordinatesToWKT`), `countryUtils.ts`, `getUntimezonedDateStr.ts`.
- **Toast**: `toast/` (`useToast`, `ToastContainer`, `ConfirmDialog`).

### Map library (`src/lib/map/`)
- `index.ts` — constants, layer/source factories, `lineClassColorExpression`. Re-exports from `style.ts`.
- `style.ts` — styling source of truth (see above).
- `mapState.ts` — save/load map position.
- **Hooks**: `useMapLibre`, `useRouteEditor`, `useStationSearch`, `useRouteLength`, `useAdminLayerVisibility`, `useAdminMapOverlays`, `useAdminNotesPopup`, `useMapTileRefresh`, `useRouteHighlighting` (takes `kind: 'planner' | 'view'`), `useLayerFilters`.
- **Interactions**: `userMapInteractions.ts`, `adminMapInteractions.ts`.
- **Utils**: `userRouteStyling.ts` (`getUserRouteWidthExpression`, `getUserRouteClickBufferWidthExpression`, `getUserRouteScenicOutlineWidthExpression`, `getAdminRouteWidthExpression`), `tooltipFormatting.ts`, `distance.ts`.

### Scripts (`src/scripts/`)
- **Data**: `pruneData.ts`, `importMapData.ts`, `verifyRouteData.ts`, `applyVectorTiles.ts`, `markAllRoutesInvalid.ts` (migration reference), `listStations.ts`, `exportRoutes.ts`, `importRoutes.ts`.
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

### Country Settings & Stats
8 countries (CZ/SK/AT/PL/DE/LT/LV/EE) with flag emojis (Unicode regional indicators). Select All / None. Per-country stats via `getProgressByCountry()` (matches when both endpoints in country). Persisted in `user_preferences`. Filter applies to map + stats; **admin map ignores it**.

### Admin
Click railway part → capture exact coordinate for start/end. Right-click anywhere → create note; right-click existing note → edit/delete. Note popup: text field, save (Ctrl+Enter), delete, close (Esc). Invalid routes in grey with banner; "Edit Route Geometry" re-picks coordinates with same pathfinding.

## Development workflow

### Database migrations
When changing schema or transforming existing data, create a TS script in `src/scripts/`. Pattern: import `pool` from `@/lib/db`, run SQL, log progress, exit. Use `markAllRoutesInvalid.ts` as the reference. Register in `package.json` and document in this file's Database Operations + Scripts sections.

### Type checking
Run `npx tsc --noEmit` after each batch of related changes. Don't run full builds unless asked.

### Linting & formatting
Biome is the single linter + formatter (`biome.json`). All code must conform — run `npm run lint` and fix findings before finishing. Use `npm run lint:fix` for safe autofixes, but **never blanket-apply `--unsafe`**: Biome's `useExhaustiveDependencies` autofix mangles intentional hook dependency arrays (drops trigger deps, adds recreated-every-render objects → infinite loops). Fix hook-deps findings by hand — memoize with `useCallback`/`useMemo`, or add a `// biome-ignore lint/correctness/useExhaustiveDependencies: <reason>` comment when the omission is intentional.

### TypeScript
ESNext modules, strict mode, run scripts via `tsx`.
