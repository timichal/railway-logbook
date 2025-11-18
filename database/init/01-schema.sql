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

-- Railway part splits (manually split segments for detailed routing)
CREATE TABLE railway_part_splits (
    id TEXT PRIMARY KEY, -- Compound ID format: "parent_id-segment_number" (e.g., "12345-1")
    parent_id BIGINT NOT NULL, -- Reference to original railway_parts.id
    segment_number INTEGER NOT NULL CHECK (segment_number IN (1, 2)), -- Which segment of the split (1 or 2)
    geometry GEOMETRY(LINESTRING, 4326) NOT NULL, -- PostGIS LineString for the split segment
    geometry_3857 GEOMETRY(LINESTRING, 3857), -- Web Mercator projection for tile serving
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_parent_segment UNIQUE (parent_id, segment_number)
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
    geometry GEOMETRY(LINESTRING, 4326), -- PostGIS LineString
    length_km NUMERIC, -- Route length in kilometers (calculated from geometry)
    start_country VARCHAR(2), -- ISO 3166-1 alpha-2 country code of start point
    end_country VARCHAR(2), -- ISO 3166-1 alpha-2 country code of end point
    starting_part_id BIGINT, -- Reference to starting railway_part for recalculation
    ending_part_id BIGINT, -- Reference to ending railway_part for recalculation
    is_valid BOOLEAN DEFAULT TRUE, -- Route validity flag (for recalculation errors)
    error_message TEXT, -- Error details if route recalculation fails
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User trips (supports multiple trips per route)
CREATE TABLE user_trips (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES railway_routes(track_id) ON DELETE CASCADE,
    date DATE, -- Date of trip (can be null for unlogged routes)
    note TEXT, -- User note
    partial BOOLEAN DEFAULT FALSE, -- Partial completion flag
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User preferences (for country filtering and other settings)
CREATE TABLE user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    selected_countries TEXT[] NOT NULL DEFAULT ARRAY['CZ', 'SK', 'AT', 'PL', 'DE', 'LT', 'LV', 'EE'], -- ISO 3166-1 alpha-2 country codes
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_stations_coordinates ON stations USING GIST (coordinates);
CREATE INDEX idx_railway_parts_geometry ON railway_parts USING GIST (geometry);
CREATE INDEX idx_railway_part_splits_geometry ON railway_part_splits USING GIST (geometry);
CREATE INDEX idx_railway_part_splits_geometry_3857 ON railway_part_splits USING GIST (geometry_3857);
CREATE INDEX idx_railway_part_splits_parent_id ON railway_part_splits (parent_id);
CREATE INDEX idx_railway_routes_geometry ON railway_routes USING GIST (geometry);
CREATE INDEX idx_railway_routes_from_station ON railway_routes (from_station);
CREATE INDEX idx_railway_routes_to_station ON railway_routes (to_station);
CREATE INDEX idx_railway_routes_start_country ON railway_routes (start_country);
CREATE INDEX idx_railway_routes_end_country ON railway_routes (end_country);
CREATE INDEX idx_railway_routes_starting_part ON railway_routes (starting_part_id);
CREATE INDEX idx_railway_routes_ending_part ON railway_routes (ending_part_id);
CREATE INDEX idx_user_trips_user_id ON user_trips (user_id);
CREATE INDEX idx_user_trips_track_id ON user_trips (track_id);
CREATE INDEX idx_user_trips_date ON user_trips (date);
