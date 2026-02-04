-- Railway Management Database Schema

-- Enable PostGIS and unaccent extensions first
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255), -- Optional display name
    password VARCHAR(255), -- To be used later for authentication
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default user for existing data
INSERT INTO users (id, email, name, password) VALUES (1, 'osm@zlatkovsky.cz', 'Michal', '$2b$12$71HlDo/fgRFXvin5VZ4t5uMRfsUkkREuusSG9z13BGs00vi2AUZIe');

-- Fix the sequence to start from the next available ID
SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));

-- Railway stations (Point features from GeoJSON)
CREATE TABLE stations (
    id BIGINT PRIMARY KEY, -- OSM @id
    name VARCHAR(255) NOT NULL,
    coordinates GEOMETRY(POINT, 4326) NOT NULL, -- PostGIS point (lon, lat)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Railway parts/segments (original line data from OSM)
CREATE TABLE railway_parts (
    id BIGINT PRIMARY KEY, -- OSM @id
    geometry GEOMETRY(LINESTRING, 4326), -- PostGIS LineString
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Railway lines/routes (objective data only)
CREATE TABLE railway_routes (
    track_id SERIAL PRIMARY KEY, -- Auto-generated unique track identifier
    from_station TEXT NOT NULL, -- Starting station/location
    to_station TEXT NOT NULL, -- Ending station/location
    track_number VARCHAR(100), -- Local track number(s) - optional
    description TEXT, -- Route description
    usage_type INTEGER NOT NULL, -- Usage type (0=Regular, 1=Special)
    frequency TEXT[] DEFAULT ARRAY[]::TEXT[], -- Frequency tags (Daily, Weekdays, Weekends, Once a week, Seasonal)
    link TEXT, -- External URL/link for the route
    scenic BOOLEAN DEFAULT FALSE, -- Flag to mark route as scenic
    hsl BOOLEAN DEFAULT FALSE, -- Flag to mark route as high-speed line
    geometry GEOMETRY(LINESTRING, 4326), -- PostGIS LineString
    length_km NUMERIC, -- Route length in kilometers (calculated from geometry)
    start_country VARCHAR(2), -- ISO 3166-1 alpha-2 country code of start point
    end_country VARCHAR(2), -- ISO 3166-1 alpha-2 country code of end point
    starting_coordinate GEOMETRY(POINT, 4326), -- Exact start coordinate on route (for verification)
    ending_coordinate GEOMETRY(POINT, 4326), -- Exact end coordinate on route (for verification)
    starting_part_id TEXT, -- DEPRECATED: Reference to starting railway_part (kept for migration, will be removed)
    ending_part_id TEXT, -- DEPRECATED: Reference to ending railway_part (kept for migration, will be removed)
    is_valid BOOLEAN DEFAULT TRUE, -- Route validity flag (for recalculation errors)
    error_message TEXT, -- Error details if route recalculation fails
    intended_backtracking BOOLEAN DEFAULT FALSE, -- Flag to indicate backtracking is intentional
    has_backtracking BOOLEAN DEFAULT FALSE, -- Flag set by verification script indicating route uses backtracking path
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User journeys (named, dated collections of routes)
CREATE TABLE user_journeys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (name != ''), -- User-defined journey name (required, non-empty)
    description TEXT, -- Optional journey description
    date DATE NOT NULL, -- Journey date (required)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User logged parts (connects journeys to routes with partial flags)
CREATE TABLE user_logged_parts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    journey_id INTEGER NOT NULL REFERENCES user_journeys(id) ON DELETE CASCADE,
    track_id INTEGER REFERENCES railway_routes(track_id) ON DELETE SET NULL, -- Nullable to preserve journey history
    partial BOOLEAN DEFAULT FALSE, -- Per-journey partial flag
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User preferences (for country filtering and other settings)
CREATE TABLE user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    selected_countries TEXT[] NOT NULL DEFAULT ARRAY['CZ', 'SK', 'AT', 'PL', 'DE', 'LT', 'LV', 'EE'], -- ISO 3166-1 alpha-2 country codes
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Admin notes (admin-only map annotations)
CREATE TABLE admin_notes (
    id SERIAL PRIMARY KEY,
    coordinate GEOMETRY(POINT, 4326) NOT NULL, -- PostGIS point (lon, lat)
    text TEXT NOT NULL, -- Note content
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_stations_coordinates ON stations USING GIST (coordinates);
CREATE INDEX idx_railway_parts_geometry ON railway_parts USING GIST (geometry);
CREATE INDEX idx_railway_routes_geometry ON railway_routes USING GIST (geometry);
CREATE INDEX idx_railway_routes_starting_coordinate ON railway_routes USING GIST (starting_coordinate);
CREATE INDEX idx_railway_routes_ending_coordinate ON railway_routes USING GIST (ending_coordinate);
CREATE INDEX idx_railway_routes_from_station ON railway_routes (from_station);
CREATE INDEX idx_railway_routes_to_station ON railway_routes (to_station);
CREATE INDEX idx_railway_routes_start_country ON railway_routes (start_country);
CREATE INDEX idx_railway_routes_end_country ON railway_routes (end_country);
CREATE INDEX idx_railway_routes_starting_part ON railway_routes (starting_part_id);
CREATE INDEX idx_railway_routes_ending_part ON railway_routes (ending_part_id);

-- User journeys indexes
CREATE INDEX idx_user_journeys_user_id ON user_journeys (user_id);
CREATE INDEX idx_user_journeys_date ON user_journeys (date);
CREATE INDEX idx_user_journeys_user_date ON user_journeys (user_id, date DESC); -- Composite index for common query pattern

-- User logged parts indexes
CREATE INDEX idx_logged_parts_user_id ON user_logged_parts (user_id);
CREATE INDEX idx_logged_parts_journey_id ON user_logged_parts (journey_id);
CREATE INDEX idx_logged_parts_track_id ON user_logged_parts (track_id);
CREATE UNIQUE INDEX idx_logged_parts_unique ON user_logged_parts (journey_id, track_id); -- Same route once per journey
CREATE INDEX idx_logged_parts_user_track_partial ON user_logged_parts (user_id, track_id, partial); -- CRITICAL: Progress calculation performance

CREATE INDEX idx_admin_notes_coordinate ON admin_notes USING GIST (coordinate);

-- Trigger function to auto-update updated_at timestamp (reusable across tables)
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at on user_journeys updates
CREATE TRIGGER user_journeys_update_timestamp
BEFORE UPDATE ON user_journeys
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Trigger to auto-update updated_at on admin_notes updates
CREATE TRIGGER admin_notes_update_timestamp
BEFORE UPDATE ON admin_notes
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();
