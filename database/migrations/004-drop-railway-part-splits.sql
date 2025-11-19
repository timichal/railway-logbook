-- Migration: Drop railway_part_splits table
-- This table is no longer needed after migrating to coordinate-based routing
-- Run this on existing databases to clean up

-- Drop the table (CASCADE will drop all related constraints)
DROP TABLE IF EXISTS railway_part_splits CASCADE;

-- Note: The railway_part_splits_tile vector tile function will automatically
-- become unavailable once the table is dropped (Martin will handle this gracefully)
