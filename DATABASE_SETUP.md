# Database Setup for Railway Logbook

This guide explains how to set up the database system for storing and serving railway data.

## Architecture

The system separates data into two categories:
- **Objective Data**: Railway routes, stations, operators, usage types (stored in `railway_routes` and `stations` tables)
- **User Data**: Personal annotations like ride dates and notes (stored in `user_railway_data` table with user_id)

## Setup Instructions

### 1. Start the Database

```bash
# Start PostgreSQL with PostGIS in Docker
docker-compose up -d db
```

This will:
- Create a PostgreSQL 16 database with PostGIS extension
- Initialize the schema from `database/init/01-schema.sql`
- Create tables for users, stations, railway_routes, and user_railway_data
- Insert a default admin user (ID: 1)

### 2. Load Data from GeoJSON

```bash
# Load pruned GeoJSON into the database (from root directory)
npm run importMapData <filepath>
```

The loading script (`src/scripts/populateDb.ts`) will:
- Parse the GeoJSON file (e.g., data/cz-pruned.geojson)
- Load stations and railway_parts into the database
- Automatically recalculate existing routes if any are found
- Skip recalculation on initial setup (no routes exist yet)
- Handle geometry data with PostGIS spatial types

When recalculating routes (on subsequent runs):
- Uses stored starting_part_id and ending_part_id for each route
- Marks routes as invalid (is_valid=false) if they can't be recalculated
- Invalid routes can be fixed via the admin interface "Edit Route Geometry" feature

### 3. Frontend Database Integration

The frontend now uses:
- **Server Actions** (`src/lib/railway-actions.ts`) to query the database
- **Database connection** (`src/lib/db.ts`) using PostgreSQL connection pooling
- **Type definitions** (`src/lib/types.ts`) for type-safe database operations

### 4. Environment Configuration

Copy the database configuration:
```bash
cp .env.example .env
```

Update the database connection settings if needed.

## Database Schema

### Tables

1. **users** - User accounts
   - `id` (serial primary key)
   - `email` (unique, used as username)
   - `password` (for future authentication)

2. **stations** - Railway stations (Point features)
   - `id` (OSM @id, primary key)
   - `name`
   - `coordinates` (PostGIS Point with SRID 4326)

3. **railway_routes** - Railway lines (objective data)
   - `track_id` (auto-generated SERIAL primary key)
   - `name`
   - `description` (optional custom description)
   - `usage_type` (INTEGER NOT NULL: 0=Regular, 1=Seasonal, 2=Special)
   - `geometry` (PostGIS LineString with SRID 4326)
   - `length_km` (calculated automatically from geometry)
   - `starting_part_id` (BIGINT, reference to starting railway_part for recalculation)
   - `ending_part_id` (BIGINT, reference to ending railway_part for recalculation)
   - `is_valid` (BOOLEAN, marks routes that can't be recalculated after OSM updates)
   - `error_message` (TEXT, stores error details for invalid routes)

4. **railway_parts** - Raw OSM railway segments
   - `id` (OSM @id, primary key)
   - `geometry` (PostGIS LineString with SRID 4326)
   - Used for creating new routes via admin interface

5. **user_railway_data** - User-specific annotations
   - `user_id` → `users.id`
   - `track_id` → `railway_routes.track_id`
   - `date` (date of ride)
   - `note` (text)
   - `partial` (boolean, marks incomplete rides)

### Key Features

- **PostGIS Integration**: Spatial indexing for efficient map queries
- **User Separation**: Each user has their own ride history and notes
- **Data Integrity**: Foreign key constraints and unique constraints
- **Performance**: Optimized indexes for common query patterns

## Usage

### Querying Data

```typescript
// Get all stations
const stations = await getAllStations();

// Get data formatted as GeoJSON for map display (includes dynamic styling)
const geoJson = await getRailwayDataAsGeoJSON(1);

// Update user's railway data (including partial flag)
await updateUserRailwayData("track_123", "2024-01-15", "Great scenic route!", false);

// Update with partial completion
await updateUserRailwayData("track_456", "2024-01-20", "Only rode part of this route", true);
```

The frontend automatically handles:
- **Dynamic Styling**: Route colors based on completion status
  - DarkGreen (#006400) for fully visited routes (date exists and not partial)
  - Dark orange (#d97706) for partially completed routes
  - Crimson for unvisited routes
- **Usage Type Display**: Enum numbers (0=Regular, 1=Seasonal, 2=Special) displayed in popups
- **Weight Calculation**: Thinner lines (weight=2) for Special usage routes (usage_type=2)
- **Completion Stats**: Only fully completed routes (not partial) count toward progress percentage

### Adding New Users

```sql
INSERT INTO users (email) VALUES ('user@example.com');
```

Then use the returned user ID for all user-specific operations.

## Development

- **Database Changes**: Update `database/init/01-schema.sql` and rebuild containers with `docker-compose down -v && docker-compose up -d db`
- **Data Reloading**: Run `npm run importMapData` from the root directory
- **Frontend Changes**: Server actions in `src/lib/railway-actions.ts` provide type-safe database access
- **TypeScript**: All scripts are now TypeScript with proper type checking
- **Admin Security**: All admin-only operations (create, update, delete routes) require user.id === 1

## Production Considerations

- Use environment variables for database credentials
- Enable SSL for database connections
- Set up database backups
- Consider read replicas for better performance
- Implement proper user authentication and authorization
