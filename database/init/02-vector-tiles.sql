-- Vector Tile Optimization
-- This file adds optimizations for serving vector tiles via Martin

-- Add Web Mercator (EPSG:3857) geometry columns for tile serving
-- These are used by Martin for efficient tile generation

ALTER TABLE railway_parts
ADD COLUMN IF NOT EXISTS geometry_3857 GEOMETRY(LINESTRING, 3857);

ALTER TABLE railway_routes
ADD COLUMN IF NOT EXISTS geometry_3857 GEOMETRY(LINESTRING, 3857);

ALTER TABLE stations
ADD COLUMN IF NOT EXISTS coordinates_3857 GEOMETRY(POINT, 3857);

-- Populate the Web Mercator geometries from existing WGS84 data
UPDATE railway_parts
SET geometry_3857 = ST_Transform(geometry, 3857)
WHERE geometry IS NOT NULL AND geometry_3857 IS NULL;

UPDATE railway_routes
SET geometry_3857 = ST_Transform(geometry, 3857)
WHERE geometry IS NOT NULL AND geometry_3857 IS NULL;

UPDATE stations
SET coordinates_3857 = ST_Transform(coordinates, 3857)
WHERE coordinates IS NOT NULL AND coordinates_3857 IS NULL;

-- Create spatial indexes for the Web Mercator geometries
CREATE INDEX IF NOT EXISTS idx_railway_parts_geometry_3857
ON railway_parts USING GIST (geometry_3857);

-- Partial index for railway_parts_tile below z9, which draws only the parts over
-- 500m (or 1km): measuring every part in a low-zoom tile took longer than drawing
-- the ones kept, and the index skips the short two thirds of the network.
CREATE INDEX IF NOT EXISTS idx_railway_parts_geometry_3857_long
ON railway_parts USING GIST (geometry_3857) WHERE ST_Length(geometry_3857) > 500;

CREATE INDEX IF NOT EXISTS idx_railway_routes_geometry_3857
ON railway_routes USING GIST (geometry_3857);

CREATE INDEX IF NOT EXISTS idx_stations_coordinates_3857
ON stations USING GIST (coordinates_3857);

-- Partial index for the user map, which only ever asks for near_route stations
CREATE INDEX IF NOT EXISTS idx_stations_coordinates_3857_near_route
ON stations USING GIST (coordinates_3857) WHERE near_route;

-- Station name search (searchStationsByName in src/lib/routeQueries.ts) is a
-- substring match, `%…%`, on search_key(name), which no btree can serve: a
-- sequential scan running unaccent over every station name, ~60ms a keystroke.
-- A trigram index answers it in about 1ms from three characters up (two are
-- below a trigram, and still scan). unaccent() itself is only STABLE — it reads
-- its dictionary through search_path — so the index goes through a wrapper that
-- names the dictionary outright and can therefore be declared IMMUTABLE. The
-- query must call the same function, or the planner cannot match the index.
-- Partial on near_route, the only stations the search offers.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
RETURN public.unaccent('public.unaccent'::regdictionary, $1);

-- A name as the searches compare it: lower-cased, without diacritics, and without
-- the spaces, hyphens, dashes, apostrophes and dots between its parts, so
-- "owariseto", "owari-seto" and "Owari Seto" are one query, and "sanyo" finds
-- "San'yō" — operators romanize the same name with and without them. The SQL
-- twin of foldForSearch (src/lib/searchText.ts, its separators in
-- src/lib/shared/searchQuery.ts); tests/searchText.sql.test.ts holds the two
-- together. The whitespace is JavaScript's `\s` spelled out, not [[:space:]],
-- which follows the locale and leaves out the no-break spaces. The index below
-- stores its results, so a new body needs a new index name (and a DROP of the
-- old one) for the deploy to rebuild it.
CREATE OR REPLACE FUNCTION search_key(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
RETURN regexp_replace(
  lower(public.immutable_unaccent($1)),
  '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff''’‘ʼ.·・‐‑‒–—―-]+',
  '',
  'g'
);

DROP INDEX IF EXISTS idx_stations_name_trgm_near_route;

CREATE INDEX IF NOT EXISTS idx_stations_search_key_trgm_near_route
ON stations USING GIN (search_key(name) gin_trgm_ops) WHERE near_route;

-- Function: tile_unit
-- One unit of a 4096-extent tile at zoom z, in metres of Web Mercator (the world
-- is 40075016.68 wide): the grid ST_AsMVTGeom snaps every coordinate to.
--
-- Line tiles simplify their geometry by one unit before ST_AsMVTGeom. The snap
-- alone keeps every point of a dense OSM line that lands on a different grid
-- cell, so a z4-z8 route tile was two thirds redundant vertices; simplified, its
-- geometry is a third to a fifth the size and no line moves by more than the snap
-- already moves it (an eighth of a pixel), so overlays drawn from full-resolution
-- GeoJSON still line up. preserveCollapsed keeps a line shorter than a unit, which
-- ST_AsMVTGeom then treats as it always did.
CREATE OR REPLACE FUNCTION tile_unit(z integer) RETURNS float8
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
RETURN 40075016.68 / (4096 * 2 ^ z);

-- Function: railway_parts_tile
-- Serves railway parts (raw OSM segments) as vector tiles, fewer of them at low zoom.
--
-- Like every function below that builds a tile, one SQL statement with the tile
-- envelope in its FROM list, which evaluates it once per tile rather than per row.
-- None filters out a NULL geom (clipped away): ST_AsMVT skips those rows itself,
-- and the filter, pushed down into the scan, ran ST_AsMVTGeom twice per row.
CREATE OR REPLACE FUNCTION railway_parts_tile(z integer, x integer, y integer)
RETURNS bytea AS $$
    -- 'id' is the feature id, for MapLibre feature state
    SELECT ST_AsMVT(mvtgeom.*, 'railway_parts', 4096, 'geom', 'id')
    FROM (
        SELECT
            id,
            -- 4096 = tile extent, 64 = buffer, true = clip to tile
            ST_AsMVTGeom(ST_Simplify(geometry_3857, tile_unit(z), true), envelope, 4096, 64, true) AS geom
        FROM railway_parts, ST_TileEnvelope(z, x, y) AS envelope
        WHERE geometry_3857 && envelope
            -- Below z9 only the longer segments: over 1km below z8, over 500m at z8
            AND (z >= 9 OR ST_Length(geometry_3857) > CASE WHEN z < 8 THEN 1000 ELSE 500 END)
        -- Order doesn't matter for parts, but consistent ordering helps caching
        ORDER BY id
    ) AS mvtgeom;
$$ LANGUAGE sql
-- STABLE, not IMMUTABLE, here and in every tile function below: they read tables,
-- and IMMUTABLE lets the planner fold a call with constant arguments into its
-- result once and reuse it after the data has changed.
STABLE
STRICT
PARALLEL SAFE
-- Planned for its own zoom every time: only with z folded to a constant does the
-- length filter imply idx_railway_parts_geometry_3857_long's predicate.
SET plan_cache_mode = force_custom_plan;

-- Index: the stretch rows behind user_fully_ridden_routes' second branch.
-- Partial because a stretch is rare (almost every logged part is a whole route),
-- so this keeps that branch off the table entirely.
CREATE INDEX IF NOT EXISTS idx_logged_parts_stretches
ON user_logged_parts (user_id, track_id) WHERE covered_start IS NOT NULL;

-- Function: user_fully_ridden_routes
-- The routes a user has ridden the whole of, one row per track_id.
--
-- Two ways that happens, one branch each:
--   1. some journey logged the route with partial = FALSE -- an index-only scan
--      of (user_id, track_id, partial);
--   2. the partial stretches add up to the whole line: two rides over one route,
--      A->B and B->C, complete it even though neither ride did. Nothing merges
--      the stored rows -- each journey keeps its own stretch -- so the union is
--      computed here, on read. Only rows carrying a stretch can contribute, and
--      idx_logged_parts_stretches indexes exactly those.
--
-- Each stretch is widened by 0.3km worth of the route's length (capped at 0.25 of
-- it, which only bites on routes under ~1.2km) before the union. A route's
-- endpoint is a hand-picked click point rather than the platform centre, so a
-- ride from a terminus is recorded as starting a little past 0; the same widening
-- closes the small gap left when an OSM recalculation moves two rides' shared
-- station fraction apart between them. Rows of unknown extent (both fractions
-- NULL: a route ticked partial by hand) are excluded by branch 2's WHERE -- they
-- say a piece was ridden without saying which, and GREATEST/LEAST ignore NULLs,
-- so a row let through would widen into the whole route and complete it alone.
--
-- **Set-returning rather than a per-route boolean on purpose.** As a scalar
-- function the tile called it once per route, and the per-call overhead cost 50%
-- on a z4 tile of 5000 routes (593ms against 398ms for the plain "has a complete
-- journey" LATERAL it replaced). Joined as a set it is evaluated once per tile,
-- which measured at or below that LATERAL from z4 to z12 -- the fixed cost is one
-- index-only scan of the user's own logged rows.
--
-- The same rule is implemented in TypeScript for the unauthenticated map's
-- localStorage log (isRouteFullyRidden in src/lib/shared/routeCoverage.ts, which owns
-- the two tolerances above). Keep the two in step.
CREATE OR REPLACE FUNCTION user_fully_ridden_routes(p_user_id integer)
RETURNS TABLE (track_id integer) AS $$
    SELECT ulp.track_id
    FROM user_logged_parts ulp
    WHERE ulp.user_id = p_user_id
      AND ulp.partial = FALSE
    UNION
    SELECT stretch.track_id
    FROM (
        SELECT
            ulp.track_id,
            ulp.covered_start,
            ulp.covered_end,
            LEAST(COALESCE(0.3 / NULLIF(rr.length_km, 0), 0), 0.25) AS tolerance
        FROM user_logged_parts ulp
        JOIN railway_routes rr ON rr.track_id = ulp.track_id
        WHERE ulp.user_id = p_user_id
          AND ulp.covered_start IS NOT NULL
    ) stretch
    GROUP BY stretch.track_id
    HAVING range_agg(numrange(
               GREATEST(stretch.covered_start::numeric - stretch.tolerance, 0),
               LEAST(stretch.covered_end::numeric + stretch.tolerance, 1),
               '[]'
           )) @> numrange(0, 1, '[]');
$$ LANGUAGE sql
STABLE
PARALLEL SAFE;

-- Function: railway_routes_mvt
-- Serves railway routes (combined lines with metadata) as vector tiles
-- Includes user-specific journey data for styling (most recent journey's date/name/partial)
-- Uses "most permissive wins" logic: route is complete if it's complete in ANY
-- journey, or if its partial stretches union to the whole route (see
-- user_fully_ridden_routes above)
-- Country filter: NULL shows every route, otherwise both endpoints must be listed.
--
-- **Not a Martin source, and it must never become one.** A user's ride history is
-- private, and anything Martin publishes answers anyone who asks: it used to take
-- user_id from the query string, so /tiles/railway_routes_tile/6/34/21?user_id=7
-- served user 7's logbook to whoever typed it. The per-user tile is now served by
-- the Next route handler under src/app/api/tiles, which resolves the session,
-- bearer or share token first and calls this function itself. Martin publishes
-- only railway_routes_tile below, which passes no user.
CREATE OR REPLACE FUNCTION railway_routes_mvt(
    z integer,
    x integer,
    y integer,
    user_id_param integer,
    selected_countries_param text[]
)
RETURNS bytea AS $$
    -- 'track_id' is the feature id, for MapLibre feature state
    SELECT ST_AsMVT(mvtgeom.*, 'railway_routes', 4096, 'geom', 'track_id')
    FROM (
        SELECT
            rr.track_id,
            rr.name,
            -- The other lines the route is part of; a TEXT[], so it reaches the
            -- client as an array literal (parsePgTextArray)
            rr.other_names,
            rr.from_station,
            rr.to_station,
            rr.description,
            rr.usage_type,
            rr.frequency,
            rr.link,
            rr.line_class,
            rr.length_km,
            rr.start_country,
            rr.end_country,
            -- Validity alone: the admin map greys invalid routes, but the error
            -- text is admin-only and this tile is public
            rr.is_valid,
            rr.under_repair,
            -- Include most recent journey data for client-side styling
            -- Use latest journey (by date, then by created_at) for route coloring
            recent_trip.date,
            recent_trip.journey_name,
            recent_trip.partial,
            -- Whether the route reads as ridden: a complete journey, or partial
            -- stretches that add up to the whole line (user_fully_ridden_routes)
            (ridden.track_id IS NOT NULL) AS has_complete_trip,
            ST_AsMVTGeom(ST_Simplify(rr.geometry_3857, tile_unit(z), true), envelope, 4096, 64, true) AS geom
        FROM railway_routes rr
        CROSS JOIN ST_TileEnvelope(z, x, y) AS envelope
        -- Most recent journey for this route (drives the hover popup and the
        -- partial styling of a route that isn't fully ridden yet)
        LEFT JOIN LATERAL (
            SELECT uj.date, uj.name as journey_name, ulp.partial
            FROM user_logged_parts ulp
            JOIN user_journeys uj ON ulp.journey_id = uj.id
            WHERE ulp.track_id = rr.track_id
                AND user_id_param IS NOT NULL
                AND ulp.user_id = user_id_param
            ORDER BY
                uj.date DESC NULLS LAST,
                uj.created_at DESC
            LIMIT 1
        ) recent_trip ON true
        -- Evaluated once per tile, not once per route (see the function's comment).
        -- With no user_id it yields nothing, so every route reads as unvisited.
        LEFT JOIN user_fully_ridden_routes(user_id_param) ridden
            ON ridden.track_id = rr.track_id
        WHERE rr.geometry_3857 && envelope
            -- Every zoom level. Country filter: if countries are specified, both
            -- the start AND end country must be among them
            AND (
                selected_countries_param IS NULL OR
                (rr.start_country = ANY(selected_countries_param) AND rr.end_country = ANY(selected_countries_param))
            )
        ORDER BY
            -- Render order: unvisited routes first (so visited are on top)
            CASE WHEN recent_trip.date IS NULL THEN 0 ELSE 1 END,
            -- Then by id, only so the order (and with it the tile bytes and Martin's
            -- ETag) doesn't follow the plan. Not by station names, whose collation
            -- cost a z4 tile about a third of its time.
            rr.track_id
    ) AS mvtgeom;
$$ LANGUAGE sql
-- STABLE, not IMMUTABLE: it reads tables. And not STRICT, which would turn the
-- NULL user of an anonymous tile into a NULL tile.
STABLE
PARALLEL SAFE;

-- Function: railway_routes_tile
-- The Martin source: the route tile with no user, so every route reads as
-- unvisited (the admin map, the anonymous map — whose colours come from
-- localStorage via feature state). Takes selected_countries from the query
-- string and nothing else; a user_id in the query string is ignored.
CREATE OR REPLACE FUNCTION railway_routes_tile(z integer, x integer, y integer, query_params json DEFAULT '{}'::json)
RETURNS bytea AS $$
    SELECT railway_routes_mvt(
        z, x, y,
        NULL,
        CASE
            WHEN query_params->>'selected_countries' IS NOT NULL
            THEN ARRAY(SELECT json_array_elements_text((query_params->>'selected_countries')::json))
        END
    );
$$ LANGUAGE sql
STABLE
STRICT
PARALLEL SAFE;

-- Function: stations_mvt
-- The station tile behind stations_tile and public_stations_tile, from zoom 9.
-- Both emit the layer name 'stations', so the map's layer definition is shared.
--
-- Always planned for the flag it is called with: a cached generic plan can't fold
-- near_route_only away, so it can't use the user map's partial near_route index
-- and filters every station in the tile instead.
CREATE OR REPLACE FUNCTION stations_mvt(z integer, x integer, y integer, near_route_only boolean)
RETURNS bytea AS $$
    SELECT ST_AsMVT(mvtgeom.*, 'stations')
    FROM (
        SELECT
            id,
            name,
            -- No buffer needed for points
            ST_AsMVTGeom(coordinates_3857, envelope, 4096, 0, true) AS geom
        FROM stations, ST_TileEnvelope(z, x, y) AS envelope
        WHERE coordinates_3857 && envelope
            AND (near_route OR NOT near_route_only)
            AND z >= 9
        -- id breaks ties between same-name stations, or their order follows the plan
        ORDER BY name, id
    ) AS mvtgeom;
$$ LANGUAGE sql
STABLE
STRICT
PARALLEL SAFE
SET plan_cache_mode = force_custom_plan;

-- Function: stations_tile
-- Every station, for the admin map: route creation needs all of them.
CREATE OR REPLACE FUNCTION stations_tile(z integer, x integer, y integer)
RETURNS bytea AS $$
    SELECT stations_mvt(z, x, y, false);
$$ LANGUAGE sql
STABLE
STRICT
PARALLEL SAFE;

-- Function: public_stations_tile
-- Only stations with an admin-defined route running within 250m (near_route — see
-- src/lib/stationProximity.ts), for the user map. OSM carries far more station
-- points than the network we map, and one with no route beside it is noise on
-- the user map: nothing to click, nothing for the planner to reach.
CREATE OR REPLACE FUNCTION public_stations_tile(z integer, x integer, y integer)
RETURNS bytea AS $$
    SELECT stations_mvt(z, x, y, true);
$$ LANGUAGE sql
STABLE
STRICT
PARALLEL SAFE;

-- Create triggers to keep Web Mercator geometries in sync
-- When WGS84 geometry is updated, automatically update EPSG:3857 version

CREATE OR REPLACE FUNCTION sync_geometry_3857()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_TABLE_NAME = 'railway_parts' THEN
        NEW.geometry_3857 := ST_Transform(NEW.geometry, 3857);
    ELSIF TG_TABLE_NAME = 'railway_routes' THEN
        NEW.geometry_3857 := ST_Transform(NEW.geometry, 3857);
    ELSIF TG_TABLE_NAME = 'stations' THEN
        NEW.coordinates_3857 := ST_Transform(NEW.coordinates, 3857);
    ELSIF TG_TABLE_NAME = 'admin_notes' THEN
        NEW.coordinate_3857 := ST_Transform(NEW.coordinate, 3857);
    ELSIF TG_TABLE_NAME = 'scenic_lines' THEN
        NEW.geometry_3857 := ST_Transform(NEW.geometry, 3857);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS railway_parts_sync_geometry ON railway_parts;
CREATE TRIGGER railway_parts_sync_geometry
    BEFORE INSERT OR UPDATE OF geometry ON railway_parts
    FOR EACH ROW
    EXECUTE FUNCTION sync_geometry_3857();

DROP TRIGGER IF EXISTS railway_routes_sync_geometry ON railway_routes;
CREATE TRIGGER railway_routes_sync_geometry
    BEFORE INSERT OR UPDATE OF geometry ON railway_routes
    FOR EACH ROW
    EXECUTE FUNCTION sync_geometry_3857();

DROP TRIGGER IF EXISTS stations_sync_geometry ON stations;
CREATE TRIGGER stations_sync_geometry
    BEFORE INSERT OR UPDATE OF coordinates ON stations
    FOR EACH ROW
    EXECUTE FUNCTION sync_geometry_3857();

-- Add Web Mercator geometry for admin_notes
ALTER TABLE admin_notes ADD COLUMN IF NOT EXISTS coordinate_3857 GEOMETRY(POINT, 3857);

UPDATE admin_notes
SET coordinate_3857 = ST_Transform(coordinate, 3857)
WHERE coordinate IS NOT NULL AND coordinate_3857 IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_notes_coordinate_3857
ON admin_notes USING GIST (coordinate_3857);

-- Function: admin_notes_tile
-- Serves admin notes as vector tiles (admin-only), all notes at all zoom levels.
-- Not a Martin source, since Martin answers anyone: the Next handler under
-- src/app/api/tiles/admin_notes checks for the admin first and calls this itself.
CREATE OR REPLACE FUNCTION admin_notes_tile(z integer, x integer, y integer)
RETURNS bytea AS $$
    SELECT ST_AsMVT(mvtgeom.*, 'admin_notes')
    FROM (
        SELECT
            id,
            text,
            note_type,
            source,
            updated_at,
            -- No buffer needed for points
            ST_AsMVTGeom(coordinate_3857, envelope, 4096, 0, true) AS geom
        FROM admin_notes, ST_TileEnvelope(z, x, y) AS envelope
        WHERE coordinate_3857 && envelope
        ORDER BY updated_at DESC
    ) AS mvtgeom;
$$ LANGUAGE sql
STABLE
STRICT
PARALLEL SAFE;

-- Function: public_notes_tile
-- Serves PUBLIC notes (note_type='Usage' only) as vector tiles for the user map.
-- Unlike admin_notes_tile this exposes only published Usage notes, and only the
-- fields the public popup needs (text + source) — Works/Todo/internal notes and
-- their text are never shipped to the public.
CREATE OR REPLACE FUNCTION public_notes_tile(z integer, x integer, y integer)
RETURNS bytea AS $$
    SELECT ST_AsMVT(mvtgeom.*, 'public_notes')
    FROM (
        SELECT
            id,
            text,
            source,
            -- No buffer needed for points
            ST_AsMVTGeom(coordinate_3857, envelope, 4096, 0, true) AS geom
        FROM admin_notes, ST_TileEnvelope(z, x, y) AS envelope
        WHERE coordinate_3857 && envelope
            AND note_type = 'Usage'
        ORDER BY updated_at DESC
    ) AS mvtgeom;
$$ LANGUAGE sql
STABLE
STRICT
PARALLEL SAFE;

-- Add trigger for admin_notes Web Mercator sync
DROP TRIGGER IF EXISTS admin_notes_sync_geometry ON admin_notes;
CREATE TRIGGER admin_notes_sync_geometry
    BEFORE INSERT OR UPDATE OF coordinate ON admin_notes
    FOR EACH ROW
    EXECUTE FUNCTION sync_geometry_3857();

-- Scenic lines: Web Mercator geometry, its sync trigger and index
ALTER TABLE scenic_lines ADD COLUMN IF NOT EXISTS geometry_3857 GEOMETRY(LINESTRING, 3857);

UPDATE scenic_lines
SET geometry_3857 = ST_Transform(geometry, 3857)
WHERE geometry IS NOT NULL AND geometry_3857 IS NULL;

CREATE INDEX IF NOT EXISTS idx_scenic_lines_geometry_3857
ON scenic_lines USING GIST (geometry_3857);

DROP TRIGGER IF EXISTS scenic_lines_sync_geometry ON scenic_lines;
CREATE TRIGGER scenic_lines_sync_geometry
    BEFORE INSERT OR UPDATE OF geometry ON scenic_lines
    FOR EACH ROW
    EXECUTE FUNCTION sync_geometry_3857();

-- Function: scenic_lines_tile
-- Every scenic line, for the user map's scenic highlight and the admin map alike.
-- Nothing in it is private, so it is a Martin source. The countries ride along for
-- the user map's country filter, which is applied client-side (a layer filter)
-- rather than in the query, so a country toggle needs no tile refresh here; the
-- names and validity are for the admin map.
CREATE OR REPLACE FUNCTION scenic_lines_tile(z integer, x integer, y integer)
RETURNS bytea AS $$
    SELECT ST_AsMVT(mvtgeom.*, 'scenic_lines', 4096, 'geom', 'id')
    FROM (
        SELECT
            id,
            from_station,
            to_station,
            start_country,
            end_country,
            is_valid,
            -- Simplified to about a pixel at this zoom first. The band is a wide,
            -- translucent, blurred line, and MapLibre blends each join of a line
            -- with the segments either side of it: at a vertex every pixel or two,
            -- which an OSM-derived line has when zoomed out, the band turns into a
            -- string of bright blotches. The routes are opaque and never show it.
            ST_AsMVTGeom(
                ST_Simplify(geometry_3857, 40075016.68 / (512 * 2 ^ z)),
                envelope,
                4096,
                64,
                true
            ) AS geom
        FROM scenic_lines,
            ST_TileEnvelope(z, x, y) AS envelope,
            -- Widened by the 64-unit MVT buffer: the band is up to 18px wide with
            -- round caps, so a line ending just inside the next tile still spills
            -- into this one, and selecting on the bare envelope cut its cap flat
            -- at the tile edge.
            ST_TileEnvelope(z, x, y, margin => 64.0 / 4096) AS query_envelope
        WHERE geometry_3857 && query_envelope
        ORDER BY id
    ) AS mvtgeom;
$$ LANGUAGE sql
STABLE
STRICT
PARALLEL SAFE;
