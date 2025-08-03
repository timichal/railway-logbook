-- Railway Management Database Schema

-- Enable PostGIS extension first
CREATE EXTENSION IF NOT EXISTS postgis;

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255), -- To be used later for authentication
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default user for existing data
INSERT INTO users (id, email) VALUES (1, 'admin@example.com');

-- Railway stations (Point features from GeoJSON)
CREATE TABLE stations (
    id BIGINT PRIMARY KEY, -- OSM @id
    name VARCHAR(255) NOT NULL,
    coordinates GEOMETRY(POINT, 4326) NOT NULL, -- PostGIS point (lon, lat)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Railway lines/routes (objective data only)
CREATE TABLE railway_routes (
    track_id VARCHAR(255) PRIMARY KEY, -- Unique track identifier
    name VARCHAR(255) NOT NULL,
    usage_types TEXT[], -- Array of usage types
    primary_operator VARCHAR(255),
    geometry GEOMETRY(LINESTRING, 4326), -- PostGIS LineString
    color VARCHAR(50), -- color from _umap_options (can be hex or named color)
    weight INTEGER DEFAULT 3, -- line weight from _umap_options
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User-specific data for railway routes
CREATE TABLE user_railway_data (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    track_id VARCHAR(255) REFERENCES railway_routes(track_id) ON DELETE CASCADE,
    last_ride DATE, -- custom.last_ride
    note TEXT, -- custom.note
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, track_id)
);

-- Create indexes for better performance
CREATE INDEX idx_stations_coordinates ON stations USING GIST (coordinates);
CREATE INDEX idx_railway_routes_geometry ON railway_routes USING GIST (geometry);
CREATE INDEX idx_railway_routes_name ON railway_routes (name);
CREATE INDEX idx_railway_routes_operator ON railway_routes (primary_operator);
CREATE INDEX idx_user_railway_data_user_id ON user_railway_data (user_id);
CREATE INDEX idx_user_railway_data_track_id ON user_railway_data (track_id);