# Database Setup for OSM Railway Map

This guide explains how to set up the database system for storing and serving railway data.

## Architecture

The system separates data into two categories:
- **Objective Data**: Railway routes, stations, operators, usage types (stored in `railway_routes` and `stations` tables)
- **User Data**: Personal annotations like last ride dates and notes (stored in `user_railway_data` table with user_id)

## Setup Instructions

### 1. Start the Database

```bash
# Start PostgreSQL with PostGIS in Docker
docker-compose up -d postgres
```

This will:
- Create a PostgreSQL 16 database with PostGIS extension
- Initialize the schema from `database/init/01-schema.sql`
- Create tables for users, stations, railway_routes, and user_railway_data
- Insert a default admin user (ID: 1)

### 2. Load Data from GeoJSON

```bash
# Load merged-only.geojson into the database (from root directory)
npm run populateDb
```

The loading script (`scripts/populateDb.ts`) will:
- Parse the GeoJSON file from data/merged-only.geojson
- Extract objective data (routes, stations, usage types, primary operators)
- Extract user data (last_ride dates and notes from properties)
- Store everything with proper data separation in the database
- Use track_id as the primary key for railway routes
- Handle usage types as enum arrays (stored as numbers in database)

### 3. Frontend Database Integration

The frontend now uses:
- **Server Actions** (`src/lib/railway-actions.ts`) to query the database
- **Database connection** (`src/lib/db.ts`) using PostgreSQL connection pooling
- **Type definitions** (`src/lib/types.ts`) for type-safe database operations

### 4. Environment Configuration

Copy the database configuration:
```bash
cd frontend
cp .env.local.example .env.local
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
   - `track_id` (unique identifier, primary key)
   - `name`
   - `description` (optional custom description)
   - `usage_types[]` (array of Usage enum numbers)
   - `primary_operator`
   - `geometry` (PostGIS LineString with SRID 4326)

4. **user_railway_data** - User-specific annotations
   - `user_id` → `users.id`
   - `track_id` → `railway_routes.track_id`
   - `last_ride` (date)
   - `note` (text)

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

// Update user's railway data
await updateUserRailwayData(1, "track_123", "2024-01-15", "Great scenic route!");
```

The frontend automatically handles:
- **Dynamic Styling**: Route colors (DarkGreen for visited, Crimson for unvisited)
- **Usage Translation**: Enum numbers converted to Czech descriptions
- **Weight Calculation**: Thinner lines (weight=2) for Special usage routes

### Adding New Users

```sql
INSERT INTO users (email) VALUES ('user@example.com');
```

Then use the returned user ID for all user-specific operations.

## Development

- **Database Changes**: Update `database/init/01-schema.sql` and rebuild containers with `docker-compose down && docker-compose up -d`
- **Data Reloading**: Run `npm run populateDb` from the root directory
- **Frontend Changes**: Server actions in `frontend/src/lib/railway-actions.ts` provide type-safe database access
- **TypeScript**: All scripts are now TypeScript with proper type checking

## Production Considerations

- Use environment variables for database credentials
- Enable SSL for database connections
- Set up database backups
- Consider read replicas for better performance
- Implement proper user authentication and authorization