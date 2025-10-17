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
    SELECT INTO result ST_AsMVT(mvtgeom.*, 'railway_parts')
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
                -- At zoom 8-10, show medium+ segments
                (z >= 8 AND z < 10 AND ST_Length(geometry_3857) > 500) OR
                -- At zoom 10+, show all segments
                (z >= 10)
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

-- Function: railway_routes_tile
-- Serves railway routes (combined lines with metadata) as vector tiles
-- Includes user-specific data (date) for styling
CREATE OR REPLACE FUNCTION railway_routes_tile(z integer, x integer, y integer, query_params json DEFAULT '{}'::json)
RETURNS bytea AS $$
DECLARE
    result bytea;
    tile_envelope geometry;
    user_id_param integer;
BEGIN
    -- Get the tile envelope in Web Mercator
    tile_envelope := ST_TileEnvelope(z, x, y);

    -- Extract user_id from query params (for user-specific styling)
    user_id_param := (query_params->>'user_id')::integer;

    -- Generate MVT tile
    SELECT INTO result ST_AsMVT(mvtgeom.*, 'railway_routes')
    FROM (
        SELECT
            rr.track_id,
            rr.name,
            rr.description,
            rr.usage_type,
            rr.primary_operator,
            -- Include user-specific data for client-side styling
            urd.date,
            urd.note,
            urd.partial,
            -- Simplify geometry for tile display
            ST_AsMVTGeom(
                rr.geometry_3857,
                tile_envelope,
                4096,
                64,
                true
            ) AS geom
        FROM railway_routes rr
        LEFT JOIN user_railway_data urd
            ON rr.track_id = urd.track_id
            AND (user_id_param IS NULL OR urd.user_id = user_id_param)
        WHERE
            -- Spatial filter using index
            rr.geometry_3857 && tile_envelope
            -- Only show routes at zoom 7+
            AND z >= 7
        ORDER BY
            -- Render order: unvisited routes first (so visited are on top)
            CASE WHEN urd.date IS NULL THEN 0 ELSE 1 END,
            rr.name
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
-- Only displayed at zoom 10+ (matching Leaflet behavior)
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
            -- Only show stations at zoom 10+
            AND z >= 10
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
