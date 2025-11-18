-- Migration: Add railway_part_splits table for manual part splitting
-- This allows admins to manually split railway parts where stations don't align with OSM part boundaries

CREATE TABLE IF NOT EXISTS railway_part_splits (
    id SERIAL PRIMARY KEY,
    part_id BIGINT NOT NULL REFERENCES railway_parts(id) ON DELETE CASCADE,
    split_coordinate GEOMETRY(POINT, 4326) NOT NULL,
    split_fraction DOUBLE PRECISION NOT NULL CHECK (split_fraction > 0 AND split_fraction < 1),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES users(id),
    UNIQUE(part_id) -- Only one split per part
);

-- Index for looking up splits by part_id
CREATE INDEX IF NOT EXISTS idx_part_splits_part_id ON railway_part_splits(part_id);

-- Spatial index on split coordinates
CREATE INDEX IF NOT EXISTS idx_part_splits_coordinate ON railway_part_splits USING GIST(split_coordinate);

COMMENT ON TABLE railway_part_splits IS 'Tracks manual splits of railway parts for better alignment with stations';
COMMENT ON COLUMN railway_part_splits.part_id IS 'Reference to the railway part being split';
COMMENT ON COLUMN railway_part_splits.split_coordinate IS 'The point along the part where it is split';
COMMENT ON COLUMN railway_part_splits.split_fraction IS 'Fraction (0.0-1.0) along the line where split occurs, calculated via ST_LineLocatePoint';
COMMENT ON COLUMN railway_part_splits.created_by IS 'Admin user who created the split';
