-- Migration: Update railway_routes_tile function to include track_number
-- Date: 2025-01-18
-- Description: Adds track_number to the railway_routes vector tile function

-- Drop and recreate the railway_routes_tile function with track_number
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
            rr.track_number,
            rr.description,
            rr.usage_type,
            rr.is_valid,
            rr.error_message,
            rr.starting_part_id,
            rr.ending_part_id,
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
            -- Show routes at all zoom levels (no zoom restriction)
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
