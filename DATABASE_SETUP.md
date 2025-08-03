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
# Install dependencies for the loading script
cd scripts
npm install

# Load merged-only.geojson into the database
npm run load-data
```

The loading script will:
- Parse the GeoJSON file
- Extract objective data (routes, stations, operators, usage types)
- Extract user data (last_ride dates and notes from descriptions)
- Store everything with proper separation in the database
- Use track_id as the primary key for railway routes

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
   - `username`, `email`

2. **stations** - Railway stations (Point features)
   - `id` (OSM @id, primary key)
   - `name`, `railway_type`
   - `coordinates` (PostGIS Point)

3. **railway_routes** - Railway lines (objective data)
   - `track_id` (unique identifier, primary key)
   - `name`, `from_station`, `to_station`
   - `usage_types[]`, `primary_operator`
   - `geometry` (PostGIS LineString)
   - `color`, `weight` (display properties)

4. **user_railway_data** - User-specific annotations
   - `user_id` → `users.id`
   - `track_id` → `railway_routes.track_id`
   - `last_ride`, `note`

### Key Features

- **PostGIS Integration**: Spatial indexing for efficient map queries
- **User Separation**: Each user has their own ride history and notes
- **Data Integrity**: Foreign key constraints and unique constraints
- **Performance**: Optimized indexes for common query patterns

## Usage

### Querying Data

```typescript
// Get all railway routes with user data for user ID 1
const routes = await getAllRailwayRoutes(1);

// Get data formatted as GeoJSON for map display
const geoJson = await getRailwayDataAsGeoJSON(1);

// Update user's railway data
await updateUserRailwayData(1, "track_123", "2024-01-15", "Great scenic route!");
```

### Adding New Users

```sql
INSERT INTO users (username, email) VALUES ('newuser', 'user@example.com');
```

Then use the returned user ID for all user-specific operations.

## Development

- **Database Changes**: Update `database/init/01-schema.sql` and rebuild containers
- **Data Reloading**: Run `npm run load-data` in the scripts directory
- **Frontend Changes**: Server actions automatically provide type-safe database access

## Production Considerations

- Use environment variables for database credentials
- Enable SSL for database connections
- Set up database backups
- Consider read replicas for better performance
- Implement proper user authentication and authorization