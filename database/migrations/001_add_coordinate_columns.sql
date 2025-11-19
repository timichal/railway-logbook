-- Migration: Add coordinate columns to railway_routes table
-- This migration adds starting_coordinate and ending_coordinate columns
-- to support coordinate-based routing instead of part-based routing

-- Add coordinate columns
ALTER TABLE railway_routes
ADD COLUMN IF NOT EXISTS starting_coordinate GEOMETRY(POINT, 4326);

ALTER TABLE railway_routes
ADD COLUMN IF NOT EXISTS ending_coordinate GEOMETRY(POINT, 4326);

-- Create spatial indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_railway_routes_starting_coordinate
ON railway_routes USING GIST (starting_coordinate);

CREATE INDEX IF NOT EXISTS idx_railway_routes_ending_coordinate
ON railway_routes USING GIST (ending_coordinate);

-- Add comments to mark old columns as deprecated
COMMENT ON COLUMN railway_routes.starting_part_id IS 'DEPRECATED: Use starting_coordinate instead';
COMMENT ON COLUMN railway_routes.ending_part_id IS 'DEPRECATED: Use ending_part_id instead';
COMMENT ON COLUMN railway_routes.starting_coordinate IS 'Exact start coordinate for route (used for recalculation)';
COMMENT ON COLUMN railway_routes.ending_coordinate IS 'Exact end coordinate for route (used for recalculation)';

-- Verify the migration
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'railway_routes'
    AND column_name IN ('starting_coordinate', 'ending_coordinate')
ORDER BY column_name;
