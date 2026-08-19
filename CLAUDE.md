# CLAUDE.md

Guidance for Claude Code working in this repo.

## Overview

Unified Next.js app for OSM railway data: fetches, processes, and visualizes railway data for two regions — 21 European countries (see `SUPPORTED_COUNTRIES` in `src/lib/constants.ts`) and Japan (see `REGIONS` in `src/lib/regions.ts`). One database, one pipeline, one deploy; the regions differ only in where they are. Single `package.json`, single `.env`, one container. Data processing scripts live alongside the web app under `src/`.

## Core Commands

### Data pipeline
- `npm run prepareMapData -- <YYMMDD> [region ...]` — download OSM, filter rail, convert to GeoJSON, prune. One Geofabrik extract per region (europe, japan), all of them unless named. Output: `./data/<region>-pruned-<version>.geojson`.
- `npm run importMapData <filepath> [<filepath> ...]` — load GeoJSON into Postgres (stations + railway_parts). **Pass every region's file to one run**: the tables are cleared once before the first file, so importing them separately drops whichever region went in first. Auto-recalculates existing routes; skips recalculation on initial load. Add `--valid-only` to recalculate only routes not already marked invalid, `--concurrency=N` to change how many routes are recalculated at once (default 4 — see `RECALC_PERFORMANCE.md`).

### Database ops
- `docker-compose up -d db` — start Postgres+PostGIS.
- `npm run verifyRouteData` — recalculate all routes, mark invalid ones. Accepts `--valid-only` and `--concurrency=N`; prints its own elapsed time.
- `npm run applyVectorTiles` — re-apply `database/init/02-vector-tiles.sql`.
- `npm run markAllRoutesInvalid` — flag all routes for recheck (use `verifyRouteData` after). **Reference example for migration scripts.**- `npm run fixSequences` — resync all SERIAL id sequences with table data. Fixes "duplicate key violates …_pkey" on inserts after rows were loaded with explicit ids (old dumps) without bumping the sequence. `importRouteData` now does this automatically; run manually if needed.
- `npm run fixStationSrid` — set SRID 4326 on any geometry row still stored as SRID 0, and report whether each geometry column declares the SRID in its type. Only needed for a database not reimported since the loader started setting the SRID explicitly; a full `importMapData` rewrites every station anyway. Safe to re-run.
- `npm run listStations` — list unique station names (debug).
- `npm run inspectPath -- "<from>" "<to>" ["<via>"...]` — run the Journey Planner pathfinder from the CLI (station names or ids) and print the chain, search time, and the gap left between each consecutive pair of routes (debug).
- `npm run exportRouteData` / `npm run importRouteData <file>` — pg_dump/psql via `docker exec`; covers `railway_routes`, `user_trips`, `user_journeys`, `user_logged_parts` (user_id=1), `admin_notes`. Output to `data/railway_data_<ISO timestamp>.sql` (e.g. `railway_data_2026-08-19T14-30-00.sql`).

### Data transfer (pscp)
- `npm run deployMapData` / `npm run downloadMapData` / `npm run downloadRouteData`.
  - `deployMapData` prepares, uploads and imports every region in one pass (see importMapData above). Accepts an optional date (YYMMDD) and an optional `--valid-only` flag (any order, e.g. `npm run deployMapData -- 260523 --valid-only`). `--valid-only` forwards to the remote `importMapData`, which only recalculates routes that aren't already invalid (`is_valid IS NOT FALSE`) — useful to skip routes that will fail recalc anyway. `importMapData` and `verifyRouteData` also accept `--valid-only` directly. `--concurrency=N` forwards the same way. Flags are matched by name in `deploy.sh`, so a new import flag has to be added there too or it will be read as the date.

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
- **stations** — Point features from OSM (name resolved in `pruneData.ts`; see Scripts). Stations mapped as **areas** (a closed way tagged `railway=station`, e.g. the SNCF/cadastre-imported station buildings that cover most of France) are reduced to their centroid in `pruneData.ts` and stored with a **negated id** — OSM node and way ids are separate namespaces that overlap numerically, and this is one BIGINT primary key. An area is dropped when a station node of the same name already sits within 150m. `near_route` BOOL — an admin-defined route runs within 250m (`STATION_ROUTE_PROXIMITY_METERS`). See "Station proximity" below.
- **railway_routes** — SERIAL `track_id`, `from_station`, `to_station`, `description`, `usage_type` (0=Regular, 1=Heritage, 2=Special; 1 & 2 are non-regular — excluded from stats/planner. Regular = in the official national timetable at any frequency; Heritage & tourist = a line of its own, outside the national timetable, published through the operator's own channels — museum/preserved railways and commercially-run tourist lines (rack railways, funiculars) alike, drawn dotted; Special = national tracks used irregularly — diversions, festival/anniversary/tourist runs — drawn dashed. Types 1 and 2 split on whose track and whose timetable, not on the kind of train: a tourist railway on its own line is 1, a tourist special over the national network is 2; service character (daily, seasonal, winter break) goes in `frequency`. Each non-regular type has its own user-map toggle and its own line layer — Regular solid (`railway_routes`), Heritage dotted (`railway_routes_heritage`), Special dashed (`railway_routes_special`) — because `line-dasharray` isn't data-driven), `frequency` TEXT[] (free-form tags, GitLab-labels style — no fixed list, no separate tag table; a tag exists only while some route uses it. `getFrequencyTags` returns the distinct in-use set for the `TagInput` autocomplete), `link`, `scenic` BOOL, `line_class` ('highspeed'|'main'|'branch', auto-classified on create/edit, manually overridable), PostGIS `geom`, `length_km`, `start_country`/`end_country` (ISO 3166-1 alpha-2), `starting_coordinate`/`ending_coordinate` (POINT — exact click points for recalculation), `is_valid`, `error_message`, `under_repair` (admin-set, only meaningful while `is_valid=false` — see "Under repair"), `intended_backtracking`, `has_backtracking`.
- **railway_parts** — raw OSM segments; includes `usage` (main/branch/industrial/tourism) and `highspeed` BOOL.
- **user_trips** — id, user_id, name (req), description, timestamps. Groups journeys.
- **user_journeys** — id, user_id, name (req), description, date (req), `trip_id` FK ON DELETE SET NULL, timestamps.
- **user_logged_parts** — id, user_id, journey_id, `track_id` FK ON DELETE CASCADE, `partial` BOOL, `covered_start`/`covered_end` (fraction range along the route geometry, both NULL when the extent is unknown — see "Partial rides"), created_at. UNIQUE per (journey_id, track_id).
- **user_preferences** — `selected_countries` TEXT[]. Defaults to all of `SUPPORTED_COUNTRIES` (20 codes); `getUserPreferences()` always writes the list explicitly, so the SQL column DEFAULT only matters for rows inserted directly via SQL.
- **admin_notes** — id, coordinate POINT, text, `note_type` ('Usage'|'UsageInternal'|'Works'|'Todo', NOT NULL — every note is typed), `source` (optional external link), timestamps. Only `note_type='Usage'` notes are public (shown on the user map); `UsageInternal` is an admin-only draft promoted to `Usage` to publish. `noteTypeOptions`/`isPublicNoteType` in `constants.ts`.

### Key architectural decisions

- **Coordinate-based routing.** Routes are defined by exact start/end POINTs (click positions on railway parts). Pathfinding (`RailwayPathFinder`) finds which parts contain each coordinate (1m tolerance — parts are matched against the exact stored click point), truncates edge parts to the click point, and stitches via `mergeLinearChain`. The primary search is BFS by hop count; a distance-weighted search is used only when the shortest path backtracks and a non-backtracking alternative is sought. Recalculation after OSM updates uses the stored coordinates.

  `mergeLinearChain` joins sublists **only at their first/last coordinates**, matching how `coordToPartIds` builds adjacency. Two OSM ways can share a node mid-way, and accepting such a match would splice in a segment that doesn't start at the chain's tail — silently producing a geometry with a jump. Callers catch the resulting "Chain is broken" and skip that part combination.
- **Regions** (`src/lib/regions.ts`). Europe and Japan are two views of one backend. A region is a **bounding box**: it is the map's `maxBounds`, and every query that must not leak the other network filters on it (`regionEnvelopeSql` → `geometry && ST_MakeEnvelope(...)`, GIST-backed). Coordinates rather than a `region` column, because the boxes are half a planet apart — nothing is ambiguous — and a bbox needs no backfill when geometry moves. The box is a display/filter extent, not a country test: it is drawn generously and covers water and slivers of neighbours, which is harmless since we only import the regions' own extracts.
  The user map needs no bbox of its own: routes carry `start_country`/`end_country`, each region declares its countries, and the existing `selected_countries` tile filter already separates them (Japan view asks for `['JP']`). A region with one country (`hasCountryFilter: false`) hides the Countries tab and pins the filter to its own list. Stations and notes need nothing at all on the tile side — the tile envelope is already geographic.
  The selected region lives in a cookie (`REGION_COOKIE`), read by the server components so the first paint is correct, and is served to the tree by `RegionProvider`/`useRegion`/`useRegionId` (`src/lib/regionContext.tsx`). Switching **clears everything picked out of the old region**: route selection and highlights (`VectorRailwayMap`), the Journey Planner form, the admin's selected route and geometry pick. Saved map position is per region (`railway-map-state-<region>`).
  Region-scoped server actions: `searchStations`, `getAllRoutes`, `getRegionTrackIds`, `getUserProgress`, `getProgressByCountry`, `getJourneysAndTrips`, `getAllRailwayRoutes`, `getValidRoutesTotalKm`, `getAllRouteEndpoints`, `getAllAdminNotes`. The trip/journey **pickers** (`getAllTrips`, `getUnassignedJourneys`) are deliberately *not* scoped — you must be able to file a journey under any trip. A journey belongs to a region when it logged a route there; one with no routes yet belongs to every region, so a freshly created journey never vanishes from the list that made it.
- **Route invalidation.** Routes that can't recalculate (no path, off-network, or >0.1km AND >1% length mismatch) get `is_valid=false` and an `error_message`. Shown in grey on admin map; admin "Edit Geometry" re-picks coordinates.
- **Under repair** (`under_repair` BOOL) splits the invalid routes in two. Some are invalid for good — the line was dismantled, the layout rebuilt — and want fixing by hand; others only fail because the OSM data is temporarily broken (a bridge being rebuilt, a way split mid-survey) and will come back on their own. The flag is admin-set from the Invalid Route box (`setRouteUnderRepair`), draws the route violet instead of grey, and moves it out of the plain "Invalid" filter into its own — the two admin filters are disjoint, so ticking both shows every invalid route. It **qualifies invalidity and never outlives it**: every path that marks a route valid clears it (geometry re-pick and metadata save in `adminRouteActions`, successful recalculation in `verifyRouteData`), and `setRouteUnderRepair` refuses to set it on a valid route. The failure branches of `verifyRouteData` leave it alone, so a flagged route stays flagged across OSM updates until it recalculates.
- **Auto line classification.** On route create/edit, length-weighted majority of intersecting railway_parts: >50% highspeed→'highspeed', >50% main→'main', else 'branch'. Admin can override.
- **Country detection.** `@rapideditor/country-coder` on first/last coordinate fills `start_country`/`end_country`.
- **Station proximity.** The user map only shows stations with a route within 250m — `stations.near_route`, computed in `stationProximity.ts`. OSM carries far more station points than the network we map, and one with no route beside it is noise: nothing to click, nothing for the planner to reach. It gates `public_stations_tile` (user map), `searchStations` (map search box + planner autocomplete), and `inspectPath`'s name lookup — nothing searchable that isn't drawn; `inspectPath` still takes a numeric station id verbatim as the escape hatch. The admin map is untouched (`stations_tile`, all stations) — route creation needs to click stations that have no route yet, which is exactly what the flag excludes. **The flag is derived from route geometry, so every write path that moves geometry has to refresh it**: `refreshAllStationProximity` after a bulk pass (`importMapData` step 3, `verifyRouteData`, `importRouteData`), and `refreshStationProximityFor` per route in `saveRailwayRoute`/`deleteRailwayRoute`, so an admin's new route reveals its stations at once. An edit or delete needs `getStationsNearRoute` **before** the write as well: once the old geometry is gone, the stations that just lost their last route can't be found. Duplicating a route needs no refresh — the copy has identical geometry.
- **Vector tiles** via Martin (port 3001): `railway_routes_tile` (accepts `selected_countries` filter), `railway_parts_tile` (zoom-filtered), `stations_tile` (zoom 9+, all stations — admin map), `public_stations_tile` (same, `near_route` only — user map; both emit the MVT layer name `stations`, so one MapLibre layer definition serves either), `admin_notes_tile` (all notes, admin map), `public_notes_tile` (`note_type='Usage'` only, exposes just text+source — user map).
- **A map click never inherits `partial`.** The route tile carries the partial flag of the most recent journey on that route; `userMapInteractions` deliberately drops it and selects with `partial: null`, since a click is a new ride, whole until said otherwise.
- **Progress.** A route counts as completed if logged with `partial=false` in any journey; partial if only `partial=true`. Country filter requires BOTH start and end country in selected list. **A covered stretch never completes a route** — even if several journeys' stretches add up to the whole line, stats still need a `partial=false` log.
- **Partial rides are stored as a fraction range**, `covered_start`/`covered_end` on `user_logged_parts`, in `ST_LineLocatePoint` space along `railway_routes.geometry`. Fractions rather than coordinates, so a stretch follows its route through an OSM recalculation; geometry is cut on read with `ST_LineSubstring` (`getCoveredStretches`) and **never simplified** — every overlay here is drawn directly over the route's own line, and a dropped vertex shows up as the overlay cutting corners at zoom. Both NULL means the extent is unknown — a route logged whole, or one ticked partial by hand. Only the Journey Planner produces a range, from the station it joins the route at, and it is dropped on write unless `partial` is set (`sanitizeRange`). Several journeys covering different stretches of one route each keep their own row; the union is never computed — the overlay simply paints them all, which comes out the same.
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
- **The terminal routes are trimmed to the stretch actually travelled** (`computeTravelledTrims`). A from/to station often sits mid-route (Nový Bor, halfway along Jedlová ⟷ Česká Lípa), so the first and last route of a plan get `partial` — a `ST_LineSubstring` of the covered stretch — plus `travelled_length_km`, and the total counts only that. Which side is covered follows from where the path continues: the first route runs from the station to the endpoint it exits through (`findConnectionEndpoint` against the next route), the last from the endpoint it is entered at to the station. Intermediate routes are always whole, since the search enters a route at one endpoint and leaves at the other. A route reached twice, or one left with under `MIN_UNTRAVELLED_KM` (0.3km) of untravelled track, stays whole. `npm run inspectPath` prints the partial legs.

### Map styling

`src/lib/map/style.ts` is the **single source of truth** for colors/widths/opacities (`COLORS`, `WIDTHS`, `CIRCLES`, `LABELS`, `OPACITIES`). Route colors come from visit status × line_class (green/orange/red, darker for highspeed). Width is a single z4→z7 zoom interpolate; all line classes visible at all zooms, just thinner when zoomed out. Scenic routes get an amber outline (its own layer because MapLibre forbids wrapping a zoom-interpolate). An invisible wide `railway_routes_click` layer sits over the visible line for touch hit areas. Hover popups use badge formatting from `utils/tooltipFormatting.ts`.

**Basemap** (`basemap.ts`). The background is OpenFreeMap's `liberty` vector style (OpenMapTiles schema, no API key, attribution declared by the source TileJSON so MapLibre picks it up unaided). It is **vector rather than raster for one reason: label language.** A raster basemap bakes its labels into the image from OSM's local `name`, so the Japan region came out in kanji with nothing to configure; in a vector style the label is a property we own, and `latinizeLabels` rewrites every name-bearing symbol layer's `text-field` to `coalesce(name:latin, name_en, name)` — Latin script, falling back to the local name so a place with no Latin name is labelled rather than blank. The test is what a layer *reads*, not what it is called: `highway-shield-non-us` and the one-way arrows read `ref`, not a name, and are left alone (`highway-name-major` does read a name).

Two consequences of the basemap being ~110 layers instead of one raster layer:
- **The fade is its own layer.** `raster-opacity: 0.6` has no vector equivalent, so `createBasemapFadeLayer` puts a `background`-type layer (needs no source, paints the whole viewport) above the basemap and below our layers, at `OPACITIES.basemapFade`. Our layers still sit on top of everything, as they did over the raster tiles.
- **The style is fetched before the map is created**, not swapped in later: MapLibre takes one style object, and a later `setStyle` would discard the layers the other hooks add on top (coverage overlay, highlights). `loadBasemapStyle` memoises the fetch per page load (both maps mount it; a region switch rebuilds the map) and resolves **null** instead of rejecting on failure or a 6s timeout — the caller then builds the old OSM raster basemap, because a railway map on a plain OSM background is usable and one with no background is not. A failure clears the memo so the next map retries.

**The POI layers are dropped** (`dropPoiLayers`, the four over the `poi` source-layer). Cafés, ATMs and bollards carry nothing to click on a railway map, and their circles compete with the station circles, which do. It also removes a whole class of upstream breakage: those layers take `icon-image` from the tile data (`["get", "class"]`), asking for one icon per OSM POI class while the sprite carries 264 names, so `bollard`, `atm`, `athletics` and many more warned to the console at the zoom POIs appear. `resolveMissingBasemapIcons` stays as the backstop for what remains — the route shields build their icon name from tag values too (`concat(network, "_", ref_length)`) — registering a 1x1 transparent pixel per missing name, which is what MapLibre already drew (label kept, icon skipped).

**Station names are ours, not the basemap's** (`createStationLabelsLayer`, `LABELS.station`). The raster basemap used to label stations itself, baked into the tile in the local script — which is how Japan came out in kanji, and why the vector switch left the dots bare (liberty's own station labels live in the dropped `poi_transit`). Drawing them from the same `stations` tile as the dots means they match exactly (the user map's `near_route` filter included), sit above the basemap fade at full contrast, and use the Latin-preferring name `pruneData` already resolved. From zoom 12, `text-allow-overlap: false` so MapLibre thins out what will not fit.

Text needs `glyphs`, which the inline style never had: the vector style brings its own, and the raster fallback declares `GLYPHS_URL` so labels survive a basemap failure. Any `text-font` must name a fontstack that endpoint serves, and it serves exactly three — Noto Sans Regular, Bold, Italic (`BASEMAP_FONT`, `BASEMAP_FONT_BOLD`); a sleeker face would mean generating and hosting our own glyph PBFs. Labels are Bold with Regular behind it in the stack, so a glyph missing from one weight falls through instead of dropping the label. Weight, not size, is what separates them from the basemap's own place names. Two ordering consequences: the admin map's route refresh re-adds its line layers with `beforeId: "station_labels"` (it appends to the top otherwise, burying the names it just drew), and the highlight layers still `moveLayer` to the very top, so a gold or orange line draws over a station name — the halo keeps it readable.

**Popups are raw HTML strings passed to MapLibre's `setHTML`, so nothing is escaped for you.** Every interpolated value must go through `escapeHtml()`, and every URL through `safeHref()` (both in `utils/tooltipFormatting.ts`); `safeHref` returns `""` for anything that isn't `http(s)`, which also guards the `window.open` double-click handlers. This is not just about admin-authored text — **station names come straight from OSM**, i.e. from a third party who can edit them.

Selection/highlight layers:
- Route Logger selection: orange `#ff6b35` overlay (same as admin selected-route style).
- Journey Planner result: gold `#FFD700`.
- My Trips browsing: orange.

**Ridden stretches** (`useCoverageOverlay`) are drawn over the route line in the visited green, from a `logged_coverage` GeoJSON source: a route ridden halfway shows a green half over its partial-orange line, instead of reading all-orange. This can't come from the route tiles — a tile carries one feature per route, and this needs a piece of one — so the stretches are cut from the stored fraction ranges on read and served as GeoJSON, one code path for both logged-in users and localStorage journeys. The layer is `moveLayer`'d before `stations` on every run: it has to sit above the route lines (which a tile refresh re-inserts) and below the highlights. It carries `usage_type` + `start_country`/`end_country` and repeats the route layer's Regular-only and country filters, or it would keep painting stretches of routes the map is filtering out.

Highlights are tile-filter overlays (`in ["id"], [literal ids]`), so they can only light up a **whole** route. Routes covered only in part therefore come with their own geometry (`PartialRouteGeometry`): `useRouteHighlighting` drops them from the tile-filter overlay and draws the stretch from a per-set `<baseId>_partial` GeoJSON source instead, same color and width. Two sets use it — the gold planner result (third argument of `HighlightRoutesFn`) and the orange Route Logger selection (`SelectedRoute.covered`, only while `partial` is still ticked: unticking claims the whole route, and the highlight follows). Those layers are deliberately **not** in `HIGHLIGHT_LAYER_IDS` — they carry no tile properties, and clicks fall through to `railway_routes_click` underneath.

## Code structure

### Routes (`src/app/`)
- `page.tsx` — main map (server component → MainLayout).
- `admin/page.tsx` — admin route mgmt (user_id=1 only).

### Components (`src/components/`)
- **User map**: `MainLayout`, `VectorRailwayMap`, `UserSidebar` (tabs + article views), `JourneyLogger` (auth), `LocalTripLogger` (unauth), `JourneyPlanner`, `JourneysAndTripsTab`, `MergedTripCard`, `MergedJourneyCard`, `LocalJourneyLogTab`, `CountriesStatsTab`, `HowToUseArticle`, `RailwayNotesArticle`.
- **Admin**: `AdminPageClient`, `VectorAdminMap`, `AdminLayerControls`, `AdminSidebar`, `AdminCreateRouteTab`, `AdminRoutesTab`, `RoutesList`, `RouteEditForm`, `NotesPopup`.
- **Shared**: `Navbar`, `MobileMenuPanel`, `RegionSwitch` (region segmented control, rendered by `Navbar` so both pages get it), `LoginForm`, `RegisterForm`.

### Library (`src/lib/`)
- **DB/actions**: `db.ts`, `dbConfig.ts`, `userActions.ts`, `userPreferencesActions.ts`, `journeyActions.ts`, `tripActions.ts`, `adminRouteActions.ts`, `adminMapActions.ts`, `adminNotesActions.ts`, `authActions.ts`, `migrationActions.ts`.
- **Data access**: `dataAccess.ts` (DB vs localStorage abstraction), `localStorage.ts`.
- **Pathfinding**: `routePathFinder.ts` (user-facing journey planner, excludes non-regular routes). See "Journey planner pathfinding" below.
- **Regions**: `regions.ts` (region definitions + `regionEnvelopeSql`), `regionContext.tsx` (`RegionProvider`, `useRegion`, `useRegionId`).
- **Utils**: `types.ts`, `constants.ts`, `stationProximity.ts` (`stations.near_route` — see "Station proximity"), `coordinateUtils.ts` (`mergeLinearChain`, `coordinatesToWKT`), `countryUtils.ts`, `getUntimezonedDateStr.ts`.
- **Toast**: `toast/` (`useToast`, `ToastContainer`, `ConfirmDialog`).

### Map library (`src/lib/map/`)
- `index.ts` — constants, layer/source factories, `lineClassColorExpression`. Re-exports from `style.ts` and `basemap.ts`.
- `style.ts` — styling source of truth (see above).
- `basemap.ts` — the basemap under the data: vector style fetch, Latin-label rewrite, fade layer, raster fallback (see "Basemap" above).
- `mapState.ts` — save/load map position.
- **Hooks**: `useMapLibre`, `useRouteEditor`, `useStationSearch`, `useRouteLength`, `useAdminLayerVisibility`, `useAdminMapOverlays`, `useAdminNotesPopup`, `useMapTileRefresh`, `useRouteHighlighting` (takes `kind: 'planner' | 'view'`), `useCoverageOverlay`, `useLayerFilters`.
- **Interactions**: `userMapInteractions.ts`, `adminMapInteractions.ts`.
- **Utils**: `userRouteStyling.ts` (`getUserRouteWidthExpression`, `getUserRouteClickBufferWidthExpression`, `getUserRouteScenicOutlineWidthExpression`, `getAdminRouteWidthExpression`), `tooltipFormatting.ts` (badges + `escapeHtml`/`safeHref`), `distance.ts`.

### Scripts (`src/scripts/`)
- **Data**: `pruneData.ts` (also resolves the single station `name`: a CJK name prefers OSM's `name:en`, since the `transliteration` package romanizes kanji through Chinese readings — 東京 → "Dong Jing"; Cyrillic/Greek are transliterated as before), `importMapData.ts`, `verifyRouteData.ts`, `applyVectorTiles.ts`, `markAllRoutesInvalid.ts` (migration reference), `fixSequences.ts` (resync SERIAL sequences), `listStations.ts`, `inspectPath.ts` (journey-planner debug), `exportRoutes.ts`, `importRoutes.ts`.
- **Shared**: `lib/geojsonFeatureStream.ts` (string-aware incremental FeatureCollection reader — see below), `lib/loadRailwayData.ts`, `lib/railwayPathFinder.ts` (admin route creation + recalc).
- **Migrations**: `fixStationSrid.ts` (SRID 4326 backfill).

**Reading GeoJSON.** Both `pruneData` and `loadRailwayData` stream multi-gigabyte FeatureCollections through `streamFeatures` in `lib/geojsonFeatureStream.ts`, which cuts out one feature at a time. It tracks string and escape state while counting braces: `osmium export` writes every OSM tag as a property, and a tag value containing an unmatched brace otherwise ends a feature early or runs past its end and swallows the ones that follow. Features that still fail to parse, and input that ends mid-feature, are **counted and raised** rather than skipped silently.

**Importing is all-or-nothing.** `loadStationsAndParts` validates every file first — present, non-empty, ending in the `]}` that closes a complete collection — because it clears the tables before its first insert, and a mistyped path or a half-finished transfer would otherwise wipe the map before discovering it has nothing to put back. The clear and reload then run in one transaction, so a failure rolls back to the previous map and readers keep being served old data until the new set commits. `DELETE` rather than `TRUNCATE` on purpose: TRUNCATE holds an ACCESS EXCLUSIVE lock until commit, which would block every tile query for the length of the import.

### Database (`database/init/`)
- `01-schema.sql` — tables, indexes, validity/country/line_class columns.
- `02-vector-tiles.sql` — MVT tile functions, Web Mercator geom columns, sync triggers.

### OSM scripts (`osmium-scripts/`)
- `prepare.sh` — unified download/filter/convert pipeline.

## UI structure

### Sidebar (main map)
Desktop: resizable left sidebar (400–1200px, default 600px). Mobile: top-half drawer (`h-1/2`) toggled by navbar hamburger; map fills bottom half. Tabs: **Route Logger**, **My Trips** (auth) / **My Journeys** (unauth), **Country Settings & Stats** (hidden in a single-country region; if it is open when the region changes, the sidebar falls back to Route Logger). Article views: **How To Use**, **Railway Notes** (full-screen with close button). `activeTab` lives in `MainLayout`, flows down via props (no useEffect sync). Map route/station clicks only active in Route Logger tab.

### Route Logger
Click routes on map to add to selection; click stations to fill Journey Planner (focused field, else from→to). A station circle sits on top of its own route and the route click handler is map-wide, so `handleRouteClick` bails when the click also hits `stations` and a station handler is registered — picking a station must not select its route too. Per-route partial toggle + remove. "Log Journey" creates a new journey with name (req), description, date (defaults today). Embedded Journey Planner: from/via*/to with drag-and-drop reordering, diacritic-insensitive autocomplete (requires PG `unaccent`), gold highlight of found routes, "Add Routes to Selection". A route the plan only partly covers is highlighted along the covered stretch only, listed with its travelled km ("partial, of N km"), and arrives in the selection with `partial` already ticked and its stretch attached — so the selection highlights that stretch alone, and logging stores it.

### My Trips / My Journeys (auth)
`JourneysAndTripsTab` — paginated (10/page, server-side via `getJourneysAndTrips(page, pageSize, search)`), debounced search (300ms). Top-level rows are either a trip (with nested journeys) or a standalone journey. Sorted by effective date desc (trip = MAX(journey.date)). Single-open coordination: one top-level card at a time, plus one nested journey edit. Map highlights: open trip shows all its journeys' routes; open journey shows only its routes.

Trip stats (`route_count`, `total_distance`) come from the shared `TRIP_STATS_SELECT` in `tripActions.ts`, used by both `getAllTrips` and `getJourneysAndTrips`. Journey and route stats are aggregated in **separate subqueries**: joining `user_journeys × user_logged_parts` directly fans out, so a route ridden on two days of one trip would be double-counted. Both the count and the distance are taken over `DISTINCT (trip_id, track_id)` — a route counts once per trip, so "N routes · X km" always refer to the same set.

### Country Settings & Stats
The current region's countries with flag emojis (Unicode regional indicators). Select All / None. Per-country stats via `getProgressByCountry()` (matches when both endpoints in country) — one `GROUPING SETS` query covering every country plus the grand total, not a query per country. Persisted in `user_preferences`. Filter applies to map + stats; **admin map ignores it**.

### Admin
Click railway part → capture exact coordinate for start/end. Right-click anywhere → create note; right-click existing note → edit/delete. Note popup: type (req), text, optional source link, save (Ctrl+Enter), delete, close (Esc). Notes are colored by type on the admin map (`Usage`=blue, `UsageInternal`=light blue, `Works`=orange, `Todo`=purple); `AdminNotesTab` filters by type and lets you switch a note's type (= publish/unpublish). Only `Usage` notes appear on the user map (hover popup shows text + source link). Invalid routes in grey with banner; "Edit Route Geometry" re-picks coordinates with same pathfinding. The banner carries a "Mark as under repair" toggle (see "Under repair"), which turns it violet to match the map and moves the route into the routes list's separate "Under repair" filter.

## Development workflow

### Database migrations
When changing schema or transforming existing data, create a TS script in `src/scripts/`. Pattern: import `pool` from `@/lib/db`, run SQL, log progress, exit. Use `markAllRoutesInvalid.ts` as the reference. Register in `package.json` and document in this file's Database Operations + Scripts sections.

### Route recalculation performance
`RECALC_PERFORMANCE.md` — why route recalculation dominates the import, how it is kept fast (a worker pool over the route list; one `ST_DWithin` query per route covering both endpoints), the constraints that must not be broken (don't shrink the pathfinder's buffer; don't wrap the run in a transaction; don't silence the pathfinder from outside), and the measurements behind the current default. Read it before touching `verifyRouteData.ts` or `scripts/lib/railwayPathFinder.ts` for performance reasons.

### Type checking
Run `npx tsc --noEmit` after each batch of related changes. Don't run full builds unless asked.

### Linting & formatting
Biome is the single linter + formatter (`biome.json`). All code must conform — run `npm run lint` and fix findings before finishing. Use `npm run lint:fix` for safe autofixes, but **never blanket-apply `--unsafe`**: Biome's `useExhaustiveDependencies` autofix mangles intentional hook dependency arrays (drops trigger deps, adds recreated-every-render objects → infinite loops). Fix hook-deps findings by hand — memoize with `useCallback`/`useMemo`, or add a `// biome-ignore lint/correctness/useExhaustiveDependencies: <reason>` comment when the omission is intentional.

### TypeScript
ESNext modules, strict mode, run scripts via `tsx`.
