-- Railway Management Database Schema

-- Enable PostGIS and unaccent extensions first
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    -- Stored lower-cased and trimmed (every write goes through lower(btrim(...)) in
    -- SQL, and the CHECK holds it to that), so the plain UNIQUE is also unique
    -- regardless of case: "Foo@x" and "foo@x" are one account.
    email VARCHAR(255) UNIQUE NOT NULL CHECK (email = lower(btrim(email))),
    name VARCHAR(255), -- Optional display name
    password VARCHAR(255), -- To be used later for authentication
    -- When the password last changed. Every token issued before it is refused
    -- (src/lib/sessionQueries.ts), which is what makes a password change sign out
    -- the sessions and app logins already out there. NULL: unchanged since the
    -- column was added, every token stands.
    password_changed_at TIMESTAMPTZ,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- id 1 is the admin (every admin check is `user_id = 1`), and it is created by
-- `npm run createAdmin`, not seeded here: a seeded row put one person's email
-- and password hash into every deployment. The sequence starts at 2 so that id 1
-- stays reserved — otherwise whoever registered first on a fresh deployment
-- would become the admin.
SELECT setval('users_id_seq', 1);

-- Railway stations (Point features from GeoJSON)
CREATE TABLE stations (
    id BIGINT PRIMARY KEY, -- OSM @id
    name VARCHAR(255) NOT NULL,
    coordinates GEOMETRY(POINT, 4326) NOT NULL, -- PostGIS point (lon, lat)
    -- TRUE when an admin-defined railway_route runs within
    -- STATION_ROUTE_PROXIMITY_METERS (250m). Derived: refreshed whenever route
    -- geometry moves. Only these stations are served to the user map
    -- (public_stations_tile), the admin map shows all of them.
    near_route BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Railway parts/segments (original line data from OSM)
CREATE TABLE railway_parts (
    id BIGINT PRIMARY KEY, -- OSM @id
    geometry GEOMETRY(LINESTRING, 4326), -- PostGIS LineString
    usage TEXT, -- OSM usage tag (main, branch, industrial, tourism, etc.)
    highspeed BOOLEAN DEFAULT FALSE, -- OSM highspeed=yes tag
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Railway lines/routes (objective data only)
CREATE TABLE railway_routes (
    track_id SERIAL PRIMARY KEY, -- Auto-generated unique track identifier
    name TEXT, -- Line name, where the region names its lines (Japan). NULL in regions whose routes are identified by their endpoints alone (Europe)
    from_station TEXT NOT NULL, -- Starting station/location
    to_station TEXT NOT NULL, -- Ending station/location
    description TEXT, -- Route description
    usage_type INTEGER NOT NULL CHECK (usage_type IN (0, 1, 2)), -- Usage type (0=Regular, 1=Heritage, 2=Special; 1 & 2 are non-regular)
    frequency TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], -- Frequency tags (Daily, Weekdays, Weekends, Once a week, Seasonal)
    link TEXT, -- External URL/link for the route
    scenic BOOLEAN NOT NULL DEFAULT FALSE, -- Flag to mark route as scenic
    line_class VARCHAR(20) NOT NULL DEFAULT 'branch' CHECK (line_class IN ('highspeed', 'main', 'branch')), -- Line classification derived from OSM data
    geometry GEOMETRY(LINESTRING, 4326) NOT NULL, -- PostGIS LineString
    length_km NUMERIC NOT NULL, -- Route length in kilometers (calculated from geometry). NOT NULL: the planner costs a route by it, and a missing one would make the route free
    -- ISO 3166-1 alpha-2 country code of the start/end point. NULL only where
    -- country-coder finds no country (a point out at sea)
    start_country VARCHAR(2) CHECK (start_country ~ '^[A-Z]{2}$'),
    end_country VARCHAR(2) CHECK (end_country ~ '^[A-Z]{2}$'),
    starting_coordinate GEOMETRY(POINT, 4326) NOT NULL, -- Exact start coordinate on route (for verification)
    ending_coordinate GEOMETRY(POINT, 4326) NOT NULL, -- Exact end coordinate on route (for verification)
    is_valid BOOLEAN NOT NULL DEFAULT TRUE, -- Route validity flag (for recalculation errors)
    error_message TEXT, -- Error details if route recalculation fails. Admin-only: never served by a public query or tile
    under_repair BOOLEAN NOT NULL DEFAULT FALSE, -- Admin-set: this route is invalid only because the OSM layout is temporarily broken (bridge works etc.), not because the line really changed
    intended_backtracking BOOLEAN NOT NULL DEFAULT FALSE, -- Flag to indicate backtracking is intentional
    has_backtracking BOOLEAN NOT NULL DEFAULT FALSE, -- Flag set by verification script indicating route uses backtracking path
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Kept by the railway_routes_update_timestamp trigger below, so no write path
    -- has to remember it
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User trips (groups of journeys, e.g., "Summer Holiday in Austria")
CREATE TABLE user_trips (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (name != ''), -- User-defined trip name (required, non-empty)
    description TEXT, -- Optional trip description
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Target of user_journeys' composite FK, so a journey can only be filed
    -- under a trip of its own user's (id alone is already unique).
    CONSTRAINT user_trips_id_user_id_key UNIQUE (id, user_id)
);

-- User journeys (named, dated collections of routes)
CREATE TABLE user_journeys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (name != ''), -- User-defined journey name (required, non-empty)
    description TEXT, -- Optional journey description
    date DATE NOT NULL, -- Journey date (required)
    trip_id INTEGER, -- Optional trip grouping (FK below)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Target of user_logged_parts' composite FK (see user_trips).
    CONSTRAINT user_journeys_id_user_id_key UNIQUE (id, user_id),
    -- A journey's trip must belong to the same user. Composite, so the schema
    -- cannot hold a cross-user link whatever a query forgets to check. Deleting
    -- the trip nulls trip_id alone: user_id is NOT NULL and stays.
    CONSTRAINT user_journeys_trip_owner_fkey FOREIGN KEY (trip_id, user_id)
        REFERENCES user_trips (id, user_id) ON DELETE SET NULL (trip_id)
);

-- User logged parts (connects journeys to routes with partial flags)
CREATE TABLE user_logged_parts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    journey_id INTEGER NOT NULL, -- FK below
    track_id INTEGER NOT NULL REFERENCES railway_routes(track_id) ON DELETE CASCADE, -- Deleted when the route is deleted
    partial BOOLEAN NOT NULL DEFAULT FALSE, -- Per-journey partial flag
    -- Which stretch of the route was ridden, as fractions along railway_routes.geometry
    -- (ST_LineLocatePoint space, 0 = the geometry's first point). Both NULL means the
    -- extent is unknown: either the whole route (partial = FALSE) or a partial ride
    -- whose extent was never captured (partial ticked by hand). Only the Journey
    -- Planner knows an exact stretch, from the station it joins the route at.
    covered_start DOUBLE PRECISION,
    covered_end DOUBLE PRECISION,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT logged_parts_covered_range CHECK (
        (covered_start IS NULL) = (covered_end IS NULL)
        AND (covered_start IS NULL OR (covered_start >= 0 AND covered_end <= 1 AND covered_start < covered_end))
    ),
    -- A logged part belongs to the same user as its journey (see user_journeys).
    CONSTRAINT user_logged_parts_journey_owner_fkey FOREIGN KEY (journey_id, user_id)
        REFERENCES user_journeys (id, user_id) ON DELETE CASCADE
);

-- User preferences (for country filtering and other settings)
CREATE TABLE user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- ISO 3166-1 alpha-2 codes. Mirrors SUPPORTED_COUNTRIES in src/lib/shared/constants.ts
    -- (same order); getUserPreferences() always supplies the list explicitly, so
    -- this default only applies to rows inserted directly via SQL.
    selected_countries TEXT[] NOT NULL DEFAULT ARRAY[
        'AT', 'BE', 'CZ', 'DK', 'EE', 'ES', 'FI', 'FR', 'DE', 'IT',
        'LV', 'LT', 'LU', 'NL', 'NO', 'PL', 'SE', 'SK', 'SI', 'CH', 'GB'
    ]
    -- Every element a two-letter upper-case code, which is what
    -- normalizeCountryCodes lets through. A NULL element is written as '?' so it
    -- fails the pattern instead of vanishing from the joined string.
    CONSTRAINT user_preferences_selected_countries_format
        CHECK (array_to_string(selected_countries, ',', '?') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'),
    -- Public map sharing. Off by default: a map is private until its owner says
    -- otherwise, and the token alone grants nothing while this is FALSE.
    public_map_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    -- Random URL slug for /shared/<token>. Minted on the first read of the
    -- sharing settings and then kept, so the link a user has copied keeps
    -- working across enable/disable cycles.
    public_map_token TEXT UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Admin notes (admin-only map annotations)
CREATE TABLE admin_notes (
    id SERIAL PRIMARY KEY,
    coordinate GEOMETRY(POINT, 4326) NOT NULL, -- PostGIS point (lon, lat)
    text TEXT NOT NULL, -- Note content
    note_type VARCHAR(20) NOT NULL CHECK (note_type IN ('Usage', 'UsageInternal', 'Works', 'Todo')), -- Categorization. Only 'Usage' is public; 'UsageInternal' is an admin-only draft.
    source TEXT, -- Optional external link, shown in the note popup
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

-- User trips indexes
CREATE INDEX idx_user_trips_user_id ON user_trips (user_id);

-- User journeys indexes. A plain (user_id) one would be the prefix of user_date.
CREATE INDEX idx_user_journeys_trip_id ON user_journeys (trip_id);
CREATE INDEX idx_user_journeys_user_date ON user_journeys (user_id, date DESC); -- Composite index for common query pattern

-- User logged parts indexes. No plain (user_id) or (journey_id) index: each
-- would be the prefix of one below, which serves the same lookups.
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

-- Trigger to auto-update updated_at on railway_routes updates. The journey
-- planner's graph cache is fingerprinted off this table (getNetworkSignature in
-- src/lib/routePathFinder.ts), and a write path that forgot the column used to
-- be the one way to leave the cache stale.
CREATE TRIGGER railway_routes_update_timestamp
BEFORE UPDATE ON railway_routes
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Trigger to auto-update updated_at on user_trips updates
CREATE TRIGGER user_trips_update_timestamp
BEFORE UPDATE ON user_trips
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

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
