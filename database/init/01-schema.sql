-- Railway Management Database Schema

-- Enable PostGIS extension first
CREATE EXTENSION IF NOT EXISTS postgis;

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
    usage_type INTEGER NOT NULL, -- Single usage type (0=Regular, 1=Seasonal, 2=Special)
    geometry GEOMETRY(LINESTRING, 4326), -- PostGIS LineString
    length_km NUMERIC, -- Route length in kilometers (calculated from geometry)
    starting_part_id BIGINT, -- Reference to starting railway_part for recalculation
    ending_part_id BIGINT, -- Reference to ending railway_part for recalculation
    is_valid BOOLEAN DEFAULT TRUE, -- Route validity flag (for recalculation errors)
    error_message TEXT, -- Error details if route recalculation fails
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User-specific data for railway routes
CREATE TABLE user_railway_data (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    track_id INTEGER REFERENCES railway_routes(track_id) ON DELETE CASCADE,
    date DATE, -- Date of ride
    note TEXT, -- User note
    partial BOOLEAN DEFAULT FALSE, -- Partial completion flag
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, track_id)
);

-- Create indexes for better performance
CREATE INDEX idx_stations_coordinates ON stations USING GIST (coordinates);
CREATE INDEX idx_railway_parts_geometry ON railway_parts USING GIST (geometry);
CREATE INDEX idx_railway_routes_geometry ON railway_routes USING GIST (geometry);
CREATE INDEX idx_railway_routes_from_station ON railway_routes (from_station);
CREATE INDEX idx_railway_routes_to_station ON railway_routes (to_station);
CREATE INDEX idx_railway_routes_starting_part ON railway_routes (starting_part_id);
CREATE INDEX idx_railway_routes_ending_part ON railway_routes (ending_part_id);
CREATE INDEX idx_user_railway_data_user_id ON user_railway_data (user_id);
CREATE INDEX idx_user_railway_data_track_id ON user_railway_data (track_id);
