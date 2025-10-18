-- Migration: Add track_number column to railway_routes table
-- Date: 2025-01-18
-- Description: Adds an optional track_number field for storing local track numbers

-- Add the track_number column
ALTER TABLE railway_routes
ADD COLUMN IF NOT EXISTS track_number VARCHAR(100);

-- Add a comment to document the column
COMMENT ON COLUMN railway_routes.track_number IS 'Local track number(s) - optional identifier used by railway operators';
