-- Migration: Change starting_part_id and ending_part_id from BIGINT to TEXT
-- This allows storing both regular part IDs (bigint as text) and split part IDs (compound format "parent-segment")

-- Step 1: Alter starting_part_id column type
ALTER TABLE railway_routes
  ALTER COLUMN starting_part_id TYPE TEXT USING starting_part_id::TEXT;

-- Step 2: Alter ending_part_id column type
ALTER TABLE railway_routes
  ALTER COLUMN ending_part_id TYPE TEXT USING ending_part_id::TEXT;

-- Note: Existing indexes on these columns will be automatically updated
