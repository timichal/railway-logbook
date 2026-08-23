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

CREATE INDEX IF NOT EXISTS idx_railway_routes_geometry_3857
ON railway_routes USING GIST (geometry_3857);

CREATE INDEX IF NOT EXISTS idx_stations_coordinates_3857
ON stations USING GIST (coordinates_3857);

-- Partial index for the user map, which only ever asks for near_route stations
CREATE INDEX IF NOT EXISTS idx_stations_coordinates_3857_near_route
ON stations USING GIST (coordinates_3857) WHERE near_route;

-- Function: railway_parts_tile
-- Serves railway parts (raw OSM segments) as vector tiles
-- Optimized with zoom-level filtering and geometry simplification
CREATE OR REPLACE FUNCTION railway_parts_tile(z integer, x integer, y integer)
RETURNS bytea AS $$
DECLARE
    result bytea;
    tile_envelope geometry;
BEGIN
    -- Get the tile envelope in Web Mercator
    tile_envelope := ST_TileEnvelope(z, x, y);

    -- Generate MVT tile with zoom-level optimization
    -- Use 'id' as feature ID for MapLibre feature-state support
    SELECT INTO result ST_AsMVT(mvtgeom.*, 'railway_parts', 4096, 'geom', 'id')
    FROM (
        SELECT
            id,
            -- Simplify geometry for tile display
            -- 4096 = tile extent, 64 = buffer, true = clip to tile
            ST_AsMVTGeom(
                geometry_3857,
                tile_envelope,
                4096,
                64,
                true
            ) AS geom
        FROM railway_parts
        WHERE
            -- Spatial filter using index
            geometry_3857 && tile_envelope
            -- Zoom-level filtering to reduce data at low zooms
            AND (
                -- At zoom < 8, only show longer segments (main lines)
                (z < 8 AND ST_Length(geometry_3857) > 1000) OR
                -- At zoom 8-9, show medium+ segments
                (z >= 8 AND z < 9 AND ST_Length(geometry_3857) > 500) OR
                -- At zoom 9+, show all segments
                (z >= 9)
            )
        -- Order doesn't matter for parts, but consistent ordering helps caching
        ORDER BY id
    ) AS mvtgeom
    WHERE geom IS NOT NULL;

    RETURN result;
END;
$$ LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE;

-- Index: the stretch rows behind user_fully_ridden_routes' second branch.
-- Partial because a stretch is rare (almost every logged part is a whole route),
-- so this keeps that branch off the table entirely.
CREATE INDEX IF NOT EXISTS idx_logged_parts_stretches
ON user_logged_parts (user_id, track_id) WHERE covered_start IS NOT NULL;

-- Superseded by user_fully_ridden_routes below; dropped so re-applying this file
-- cleans up a database that got the earlier per-route version.
DROP FUNCTION IF EXISTS route_is_fully_ridden(integer, integer, numeric);

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
-- localStorage log (isRouteFullyRidden in src/lib/routeCoverage.ts, which owns
-- the two tolerances above). Keep the two in step.
CREATE OR REPLACE FUNCTION user_fully_ridden_routes(p_user_id integer)
RETURNS TABLE (track_id integer) AS $$
    SELECT ulp.track_id
    FROM user_logged_parts ulp
    WHERE ulp.user_id = p_user_id
      AND ulp.partial = FALSE
      AND ulp.track_id IS NOT NULL
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

-- Function: railway_routes_tile
-- Serves railway routes (combined lines with metadata) as vector tiles
-- Includes user-specific journey data for styling (most recent journey's date/name/partial)
-- Uses "most permissive wins" logic: route is complete if it's complete in ANY
-- journey, or if its partial stretches union to the whole route (see
-- user_fully_ridden_routes above)
-- Supports country filtering via query params
CREATE OR REPLACE FUNCTION railway_routes_tile(z integer, x integer, y integer, query_params json DEFAULT '{}'::json)
RETURNS bytea AS $$
DECLARE
    result bytea;
    tile_envelope geometry;
    user_id_param integer;
    selected_countries_param text[];
BEGIN
    -- Get the tile envelope in Web Mercator
    tile_envelope := ST_TileEnvelope(z, x, y);

    -- Extract user_id from query params (for user-specific styling)
    user_id_param := (query_params->>'user_id')::integer;

    -- Extract selected_countries from query params (for country filtering)
    -- Parse JSON array string to PostgreSQL array
    selected_countries_param := CASE
        WHEN query_params->>'selected_countries' IS NOT NULL
        THEN ARRAY(SELECT json_array_elements_text((query_params->>'selected_countries')::json))
        ELSE NULL
    END;

    -- Generate MVT tile
    -- Use 'track_id' as feature ID for MapLibre feature-state support
    SELECT INTO result ST_AsMVT(mvtgeom.*, 'railway_routes', 4096, 'geom', 'track_id')
    FROM (
        SELECT
            rr.track_id,
            rr.from_station,
            rr.to_station,
            rr.description,
            rr.usage_type,
            rr.frequency,
            rr.link,
            rr.scenic,
            rr.line_class,
            rr.length_km,
            rr.start_country,
            rr.end_country,
            rr.is_valid,
            rr.error_message,
            rr.under_repair,
            rr.starting_part_id,
            rr.ending_part_id,
            -- Include most recent journey data for client-side styling
            -- Use latest journey (by date, then by created_at) for route coloring
            recent_trip.date,
            recent_trip.journey_name,
            recent_trip.partial,
            -- Whether the route reads as ridden: a complete journey, or partial
            -- stretches that add up to the whole line (user_fully_ridden_routes)
            (ridden.track_id IS NOT NULL) AS has_complete_trip,
            -- Simplify geometry for tile display
            ST_AsMVTGeom(
                rr.geometry_3857,
                tile_envelope,
                4096,
                64,
                true
            ) AS geom
        FROM railway_routes rr
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
        WHERE
            -- Spatial filter using index
            rr.geometry_3857 && tile_envelope
            -- Show routes at all zoom levels (no zoom restriction)
            -- Country filtering: if countries are specified, filter by start AND end country
            AND (
                selected_countries_param IS NULL OR
                (rr.start_country = ANY(selected_countries_param) AND rr.end_country = ANY(selected_countries_param))
            )
        ORDER BY
            -- Render order: unvisited routes first (so visited are on top)
            CASE WHEN recent_trip.date IS NULL THEN 0 ELSE 1 END,
            rr.from_station,
            rr.to_station
    ) AS mvtgeom
    WHERE geom IS NOT NULL;

    RETURN result;
END;
$$ LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE;

-- Function: stations_tile
-- Serves railway stations as vector tiles
-- Only displayed at zoom 9+ (matching Leaflet behavior)
CREATE OR REPLACE FUNCTION stations_tile(z integer, x integer, y integer)
RETURNS bytea AS $$
DECLARE
    result bytea;
    tile_envelope geometry;
BEGIN
    -- Get the tile envelope in Web Mercator
    tile_envelope := ST_TileEnvelope(z, x, y);

    -- Generate MVT tile
    SELECT INTO result ST_AsMVT(mvtgeom.*, 'stations')
    FROM (
        SELECT
            id,
            name,
            -- Point geometry doesn't need much simplification
            ST_AsMVTGeom(
                coordinates_3857,
                tile_envelope,
                4096,
                0,  -- No buffer needed for points
                true
            ) AS geom
        FROM stations
        WHERE
            -- Spatial filter using index
            coordinates_3857 && tile_envelope
            -- Only show stations at zoom 8+
            AND z >= 9
        ORDER BY name
    ) AS mvtgeom
    WHERE geom IS NOT NULL;

    RETURN result;
END;
$$ LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE;

-- Function: public_stations_tile
-- Same as stations_tile, but only stations with an admin-defined route running
-- within 250m (near_route — see src/lib/stationProximity.ts). OSM carries far
-- more station points than the network we map, and one with no route beside it
-- is noise on the user map: nothing to click, nothing for the planner to reach.
-- The admin map uses stations_tile and keeps seeing all of them, which is what
-- route creation needs.
CREATE OR REPLACE FUNCTION public_stations_tile(z integer, x integer, y integer)
RETURNS bytea AS $$
DECLARE
    result bytea;
    tile_envelope geometry;
BEGIN
    -- Get the tile envelope in Web Mercator
    tile_envelope := ST_TileEnvelope(z, x, y);

    -- Generate MVT tile (layer name matches stations_tile, so the map layer
    -- definition is shared between the two)
    SELECT INTO result ST_AsMVT(mvtgeom.*, 'stations')
    FROM (
        SELECT
            id,
            name,
            -- Point geometry doesn't need much simplification
            ST_AsMVTGeom(
                coordinates_3857,
                tile_envelope,
                4096,
                0,  -- No buffer needed for points
                true
            ) AS geom
        FROM stations
        WHERE
            near_route
            -- Spatial filter using index
            AND coordinates_3857 && tile_envelope
            -- Only show stations at zoom 9+
            AND z >= 9
        ORDER BY name
    ) AS mvtgeom
    WHERE geom IS NOT NULL;

    RETURN result;
END;
$$ LANGUAGE plpgsql
IMMUTABLE
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

-- Add Web Mercator geometry for admin_notes (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'admin_notes') THEN
        ALTER TABLE admin_notes ADD COLUMN IF NOT EXISTS coordinate_3857 GEOMETRY(POINT, 3857);

        UPDATE admin_notes
        SET coordinate_3857 = ST_Transform(coordinate, 3857)
        WHERE coordinate IS NOT NULL AND coordinate_3857 IS NULL;

        CREATE INDEX IF NOT EXISTS idx_admin_notes_coordinate_3857
        ON admin_notes USING GIST (coordinate_3857);

        -- Ensure note_type column exists for tile function reference
        ALTER TABLE admin_notes ADD COLUMN IF NOT EXISTS note_type VARCHAR(20);

        -- Ensure source column exists (optional external link shown in note popup)
        ALTER TABLE admin_notes ADD COLUMN IF NOT EXISTS source TEXT;

        -- Keep the note_type CHECK in sync with the supported values
        -- (drop the auto-named constraint from 01-schema if present, then re-add)
        ALTER TABLE admin_notes DROP CONSTRAINT IF EXISTS admin_notes_note_type_check;
        ALTER TABLE admin_notes ADD CONSTRAINT admin_notes_note_type_check
        CHECK (note_type IN ('Usage', 'UsageInternal', 'Works', 'Todo'));
    END IF;
END $$;

-- Function: admin_notes_tile
-- Serves admin notes as vector tiles (admin-only)
-- Shows all notes at all zoom levels
CREATE OR REPLACE FUNCTION admin_notes_tile(z integer, x integer, y integer)
RETURNS bytea AS $$
DECLARE
    result bytea;
    tile_envelope geometry;
BEGIN
    -- Get the tile envelope in Web Mercator
    tile_envelope := ST_TileEnvelope(z, x, y);

    -- Generate MVT tile
    SELECT INTO result ST_AsMVT(mvtgeom.*, 'admin_notes')
    FROM (
        SELECT
            id,
            text,
            note_type,
            source,
            updated_at,
            -- Point geometry doesn't need much simplification
            ST_AsMVTGeom(
                coordinate_3857,
                tile_envelope,
                4096,
                0,  -- No buffer needed for points
                true
            ) AS geom
        FROM admin_notes
        WHERE
            -- Spatial filter using index
            coordinate_3857 && tile_envelope
            -- Show all notes at all zoom levels
        ORDER BY updated_at DESC
    ) AS mvtgeom
    WHERE geom IS NOT NULL;

    RETURN result;
END;
$$ LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE;

-- Function: public_notes_tile
-- Serves PUBLIC notes (note_type='Usage' only) as vector tiles for the user map.
-- Unlike admin_notes_tile this exposes only published Usage notes, and only the
-- fields the public popup needs (text + source) — Works/Todo/internal notes and
-- their text are never shipped to the public.
CREATE OR REPLACE FUNCTION public_notes_tile(z integer, x integer, y integer)
RETURNS bytea AS $$
DECLARE
    result bytea;
    tile_envelope geometry;
BEGIN
    tile_envelope := ST_TileEnvelope(z, x, y);

    SELECT INTO result ST_AsMVT(mvtgeom.*, 'public_notes')
    FROM (
        SELECT
            id,
            text,
            source,
            ST_AsMVTGeom(
                coordinate_3857,
                tile_envelope,
                4096,
                0,  -- No buffer needed for points
                true
            ) AS geom
        FROM admin_notes
        WHERE
            coordinate_3857 && tile_envelope
            AND note_type = 'Usage'
        ORDER BY updated_at DESC
    ) AS mvtgeom
    WHERE geom IS NOT NULL;

    RETURN result;
END;
$$ LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE;

-- Add trigger for admin_notes Web Mercator sync (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'admin_notes') THEN
        DROP TRIGGER IF EXISTS admin_notes_sync_geometry ON admin_notes;
        CREATE TRIGGER admin_notes_sync_geometry
            BEFORE INSERT OR UPDATE OF coordinate ON admin_notes
            FOR EACH ROW
            EXECUTE FUNCTION sync_geometry_3857();
    END IF;
END $$;
