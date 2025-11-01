# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a unified OSM (OpenStreetMap) railway data processing and visualization system that fetches, processes, and serves railway data from Czech Republic and Austria. Built as a single Next.js application with integrated data processing capabilities.

### Architecture Benefits
- **Unified Dependencies** - Single `package.json` and `node_modules`
- **Shared Types** - Common type definitions between frontend and data processing
- **Simplified Deployment** - One build process, one container
- **Standard Structure** - Follows Next.js conventions with `src/` directory
- **Environment Consolidation** - Single `.env` file for all configuration

## Core Commands

### Data Processing Pipeline
- `npm run prepareMapData -- <version>` - Complete data preparation pipeline (downloads OSM data, filters rail features, converts to GeoJSON, and prunes data)
  - Required argument: OSM data version (format: YYMMDD)
  - Example: `npm run prepareMapData -- 251016`
  - Output: `./data/europe-pruned-<version>.geojson`
- `npm run importMapData <filepath>` - Loads processed GeoJSON data into PostgreSQL database
  - Required argument: path to GeoJSON file
  - Example: `npm run importMapData ./data/europe-pruned-251016.geojson`
  - Automatically recalculates existing routes if any are found
  - On initial load with no routes, skips recalculation step

### Database Operations
- `docker-compose up -d db` - Start PostgreSQL database with PostGIS
- `npm run exportRouteData` - Export railway_routes and user_railway_data (user_id=1) to SQL dump using Docker (saved to `data/railway_data_YYYY-MM-DD.sql`)
  - Requires `db` container to be running
  - Uses `docker exec` to run `pg_dump` inside the container
- `npm run importRouteData <filename>` - Import railway data from SQL dump using Docker (e.g., `npm run importRouteData railway_data_2025-01-15.sql`)
  - Requires `db` container to be running
  - Uses `docker exec` to run `psql` inside the container

### Data Transfer Operations
- `npm run uploadMapData` - Upload GeoJSON files from `./data/` to remote server via pscp
- `npm run downloadMapData` - Download GeoJSON files from remote server to `./data/` via pscp
- `npm run downloadRouteData` - Download SQL dump files from remote server to `./data/` via pscp

### Frontend Development
- `npm run dev` - Start Next.js development server with Turbopack
- `npm run build` - Build production application
- `npm run start` - Start production server
- `npm run lint` - Run ESLint checks

### Prerequisites
- **Osmium Tool** required for data processing: `conda install conda-forge::osmium-tool`
- **TypeScript execution**: Uses `tsx` for running TypeScript files directly
- **Docker** for PostgreSQL database: `docker-compose up -d db`
- **Node.js** for the unified application
- **Environment Setup**: Copy `.env.example` to `.env` and configure database credentials

## System Architecture

### Complete Data Flow
```
OSM PBF Files → Filtered OSM → GeoJSON → Pruned Data → Database → Frontend Map
     ↓              ↓           ↓           ↓            ↓           ↓
Raw Railway    Railway Only  Stations &  Cleaned    PostgreSQL   Interactive
   Data         Features     Rail Parts   Features    + PostGIS    MapLibre Map
```

### 1. Data Sources
- OpenStreetMap data from https://download.geofabrik.de/europe.html
- Country-specific OSM PBF files (stable dumps from 2025-01-01)

### 2. Processing Pipeline
1. **Download & Filter** (`osmium-scripts/prepare.sh`) - Downloads OSM PBF data and applies OpenRailwayMap filter to extract railway features
2. **Convert** (`osmium-scripts/prepare.sh`) - Converts filtered OSM data to GeoJSON format
3. **Prune** (`src/scripts/pruneData.ts`) - Applies custom filters to remove unwanted features (subways, etc.)
4. **Database Load** (`src/scripts/populateDb.ts`) - Imports processed data into PostgreSQL with user separation

### 3. Database Architecture
- **PostgreSQL 16 with PostGIS** - Spatial database for geographic data
- **Data Separation**: Objective railway data vs. user-specific annotations
- **Tables**:
  - `users` - User accounts and authentication (email as username, password field for bcrypt hashes)
  - `stations` - Railway stations (Point features from OSM with PostGIS coordinates)
  - `railway_routes` - Railway lines with auto-generated track_id (SERIAL), description, usage_type, length_km, PostGIS geometry, starting_part_id, ending_part_id, is_valid flag, and error_message
  - `railway_parts` - Raw railway segments from OSM data (used for admin route creation and recalculation)
  - `user_railway_data` - User-specific ride history (date field), personal notes, and partial flag for incomplete rides
- **Spatial Indexing**: GIST indexes for efficient geographic queries
- **Auto-generated IDs**: track_id uses PostgreSQL SERIAL for automatic ID generation
- **Route Validity Tracking**: Routes store starting_part_id and ending_part_id for recalculation; is_valid flag marks routes that can't be recalculated after OSM updates

### 4. Frontend Application
- **Next.js 15** with React 19 - Modern web application framework with App Router
- **MapLibre GL JS** - Vector tile rendering for high-performance map visualization
- **Martin Tile Server** - PostGIS vector tile server (port 3001) serving railway_routes, railway_parts, and stations as MVT tiles
- **Server Actions** - Type-safe database operations with automatic serialization
- **Authentication** - Email/password authentication with bcrypt, session management
- **Dynamic Styling** - Three-way route colors based on user data (dark green=fully completed, dark orange=partial, crimson=unvisited), weight based on usage type (thinner for Special)
- **Usage Type Display** - Frontend displays enum numbers (0=Regular, 1=Seasonal, 2=Special) in popups
- **Connection Pooling** - PostgreSQL pool for database performance
- **Shared Map Utilities** - Modular map initialization, hooks, interactions, and styling in `src/lib/map/`
- **Station Search** - Diacritic-insensitive autocomplete search (requires PostgreSQL `unaccent` extension)
- **Multi-Route Logger** - Journey planner for logging entire trips spanning multiple routes (see dedicated section below)

### 5. Admin System Architecture
- **Admin Access Control** - Restricted to user_id=1 with server-side authentication checks in all admin actions
- **Security**: All admin operations (create, update, delete routes, pathfinding) require `user.id === 1` check
- **Vector Tile Architecture**:
  - `railway_routes` and `railway_parts` served via Martin tile server (PostGIS → MVT tiles)
  - Efficient rendering of large datasets through tile-based loading
  - MapLibre GL JS handles tile caching and viewport management automatically
- **Interactive Features**:
  - Click railway parts to select start/end points for route creation
  - Click railway routes to view/edit details
  - Route preview with geometry visualization
  - Hover effects on railway parts
- **Route Management**: Create, edit geometry, update, and delete railway routes (track_id is auto-generated)
- **Route Validity Display**: Invalid routes (is_valid=false) shown in grey when unselected, with alert banner in edit panel
- **Edit Geometry Feature**: Allows fixing invalid routes by selecting new start/end points with same pathfinding mechanism
- **Components**: `AdminPageClient` → `VectorAdminMapWrapper` → `VectorAdminMap`

## Simplified Project Structure

### Root Level
- `package.json` - Unified dependencies and scripts (Next.js + data processing)
- `docker-compose.yml` - PostgreSQL database configuration
- `tsconfig.json` - TypeScript configuration
- `next.config.ts` - Next.js configuration with standalone output
- `Dockerfile` - Production container build
- `.env` - Environment variables (single file)
- `.gitignore` - Comprehensive ignore patterns

### Source Code (`src/`)

#### App Pages (`src/app/`)
- `layout.tsx` - Root layout with authentication
- `page.tsx` - Main user map page
- `login/page.tsx` - Login page
- `register/page.tsx` - Registration page
- `admin/page.tsx` - Admin route management page (user_id=1 only)

#### Components (`src/components/`)

**User Map Components:**
- `VectorRailwayMap.tsx` - Main user map with ride tracking, station search, and multi-route logger
- `VectorMapWrapper.tsx` - Wrapper for user map with authentication
- `MultiRouteLogger.tsx` - Journey planner UI for logging multiple routes (from → via → to stations)

**Admin Map Components:**
- `VectorAdminMap.tsx` - Admin map for route management with railway parts selection
- `VectorAdminMapWrapper.tsx` - Wrapper for admin map
- `AdminPageClient.tsx` - Admin page container with state management
- `AdminSidebar.tsx` - Tab-based sidebar (Create Route / Routes List)
- `AdminCreateRouteTab.tsx` - Route creation interface with start/end point selection
- `AdminRoutesTab.tsx` - Route list with search and edit functionality
- `RoutesList.tsx` - Paginated route table with validity indicators
- `RouteEditForm.tsx` - Form for editing route metadata (from/to/track/description/usage)

**Shared Components:**
- `LoginForm.tsx` - Login form with email/password
- `RegisterForm.tsx` - Registration form
- `LayerControls.tsx` - Map layer toggle controls

#### Library (`src/lib/`)

**Database & Actions:**
- `db.ts` - PostgreSQL connection pool (exports pool as default)
- `db-config.ts` - Database configuration utilities
- `railway-actions.ts` - User-facing server actions (search stations, get GeoJSON data, update user data, get progress, bulk update routes)
- `route-save-actions.ts` - Admin-only route creation/update with security checks
- `route-delete-actions.ts` - Admin-only route deletion with security checks
- `db-path-actions.ts` - Admin-only railway parts pathfinding using RailwayPathFinder
- `railway-parts-actions.ts` - Admin-only railway parts fetching by IDs
- `route-path-finder.ts` - Route-level pathfinding for multi-route journeys (user-facing)
- `auth-actions.ts` - Authentication actions (login, register, logout, getUser)

**Utilities:**
- `types.ts` - Core TypeScript type definitions (Station, GeoJSONFeature, RailwayRoute, etc.)
- `constants.ts` - Usage type options (Regular=0, Seasonal=1, Special=2)
- `coordinate-utils.ts` - Coordinate utilities (mergeLinearChain algorithm, coordinatesToWKT)

#### Map Library (`src/lib/map/`)

**Core:**
- `index.ts` - Map constants (MAPLIBRE_STYLE, MARTIN_URL), layer factories (createRailwayRoutesSource/Layer, createStationsSource/Layer), closeAllPopups utility
- `mapState.ts` - Shared map state management

**Hooks:**
- `hooks/useMapLibre.ts` - Base hook for MapLibre GL initialization with sources and layers
- `hooks/useRouteEditor.ts` - Hook for route editing functionality (edit form state, quick log/unlog, progress tracking)
- `hooks/useStationSearch.ts` - Hook for station search with debouncing and keyboard navigation
- `hooks/useRouteLength.ts` - Hook for calculating route length display

**Interactions:**
- `interactions/userMapInteractions.ts` - User map click handlers (route click, quick log/unlog)
- `interactions/adminMapInteractions.ts` - Admin map click handlers (railway parts selection, route editing)

**Utilities:**
- `utils/userRouteStyling.ts` - User route color/width expressions (three-way colors: dark green=completed, dark orange=partial, crimson=unvisited)
- `utils/railwayPartsStyling.ts` - Railway parts styling for admin map
- `utils/distance.ts` - Distance calculation utilities

#### Scripts (`src/scripts/`)

**Data Processing:**
- `pruneData.ts` - Filters unwanted railway features (removes subways, etc.)
- `populateDb.ts` - Database loading script (loads stations and railway_parts, recalculates existing routes)
- `exportRoutes.ts` - Export railway_routes table to JSON file
- `importRoutes.ts` - Import railway_routes from JSON file

**Script Utilities (`src/scripts/lib/`):**
- `loadRailwayData.ts` - Shared data loading logic
- `railwayPathFinder.ts` - Shared BFS pathfinding class for admin route creation and recalculation

### OSM Processing Scripts (`osmium-scripts/`)
- `prepare.sh` - Unified pipeline script that downloads OSM data, filters rail features, and converts to GeoJSON

### Database Schema
- `database/init/01-schema.sql` - PostgreSQL schema with PostGIS spatial indexes, route validity tracking fields
- `database/init/02-vector-tiles.sql` - Vector tile functions (railway_routes_tile shows routes at all zoom levels, railway_parts_tile with zoom filtering, stations_tile at zoom 10+) with is_valid field
- Contains tables for users, stations, railway_routes (with starting_part_id, ending_part_id, is_valid, error_message), railway_parts, and user_railway_data

### Configuration Files
- `eslint.config.mjs` - ESLint configuration
- `postcss.config.mjs` - PostCSS configuration for Tailwind
- `public/` - Static assets served by Next.js

### Output Data (`data/`)
- `<country>.tmp.osm.pbf` - Downloaded OSM data
- `<country>-rail.tmp.osm.pbf` - Filtered railway data
- `<country>-rail.tmp.geojson` - Converted to GeoJSON
- `<country>-pruned.geojson` - Custom filtered data (ready for database loading)
- `railway_data_YYYY-MM-DD.sql` - Exported railway_routes and user_railway_data (from `npm run exportRouteData`)

## Development Notes

### TypeScript Configuration
- Uses ESNext modules with strict type checking
- Execute scripts with `tsx` (no build step required)

### Data Processing
- Custom filters applied in `pruneData.ts` remove subway and unwanted railway types
- `src/scripts/populateDb.ts` uses batch inserts for performance and:
  - Executes database initialization SQL files (vector tile functions, Web Mercator columns)
  - Populates `stations` and `railway_parts` from `cz-pruned.geojson`
  - Admin users create `railway_routes` manually via the web interface

### Admin Route Creation and Management
- Admin interface allows creating new routes by clicking railway parts on the map
- Routes are built by selecting start/end points from `railway_parts`
- Shared pathfinding (`RailwayPathFinder` class) uses BFS with PostGIS spatial queries within 150km
- Route length is automatically calculated using ST_Length with geography cast
- track_id is auto-generated using PostgreSQL SERIAL
- Routes store starting_part_id and ending_part_id for recalculation after OSM updates
- `saveRailwayRoute` handles both INSERT (new routes) and UPDATE (edit geometry) with optional trackId parameter
- Uses `mergeLinearChain` algorithm to properly order and connect coordinate sublists

### Database Updates and Route Recalculation
- `npm run importMapData` automatically reloads railway_parts from pruned GeoJSON and recalculates all existing routes
- If no routes exist (initial setup), recalculation is skipped
- Recalculation uses stored starting_part_id and ending_part_id with shared `RailwayPathFinder`
- Fetches railway part geometries and uses shared `mergeLinearChain` for proper coordinate ordering (same as route creation)
- Routes that can't be recalculated are marked with is_valid=false and error_message
- Routes with distance mismatches (>0.1 km AND >1% difference) are marked invalid with detailed error message
- Invalid routes displayed in grey on admin map (orange when selected)
- Admin can fix invalid routes using "Edit Route Geometry" to select new start/end points

### User Progress Tracking
- User-specific data stored in `user_railway_data` table with date, note, and partial fields
- Progress calculated from `length_km` column in `railway_routes`
- Only fully completed routes (date exists AND partial=false) count toward completion stats
- Progress stats show completed/total km and percentage (excludes partial routes)
- Frontend displays three-way color coding:
  - Dark green (#006400 / DarkGreen) for fully completed routes
  - Dark orange (#d97706) for partially completed routes
  - Crimson for unvisited routes
- Map interactions:
  - Hover over routes shows popup with details
  - Click routes opens edit form for date/note/partial flag

### Multi-Route Logger (Journey Planner)
- **Purpose**: Log entire journeys spanning multiple railway routes at once
- **Location**: Side panel accessible via "Log Journey" button on user map
- **UI Features**:
  - From/To station selection with autocomplete search
  - Multiple optional "via" stations (add/remove dynamically)
  - All inputs support arrow key navigation and keyboard shortcuts
  - Diacritic-insensitive search (e.g., "bialystok" finds "Białystok")
  - Search prioritizes name-start matches over contains matches
  - Auto-clear station selection when user edits input
- **Pathfinding** (`route-path-finder.ts`):
  - Sequential segment pathfinding (A→B, B→C, C→D for via stations)
  - In-memory BFS graph search for performance
  - Progressive buffer search: 50km → 100km → 200km → 500km → 1000km
  - Route connection tolerance: 2000m between route endpoints
  - Station-to-route tolerance: 2000m for finding nearby routes
  - Continues from previous segment's end route for path continuity
  - Supports unlimited journey length through via stations
- **Route Highlighting**:
  - Found routes highlighted in gold (#FFD700) on map
  - Uses separate `highlighted_routes` layer with vector tile source
- **Bulk Logging**:
  - Preview shows all routes in journey (from_station ⟷ to_station format)
  - Displays total distance calculation
  - Single form to add date, note, and partial flag to all routes
  - Uses `updateMultipleRoutes` server action for efficient bulk insert/update
- **Error Handling**:
  - Validates all via stations are selected before pathfinding
  - Shows helpful errors if stations/routes not found
  - Suggests adding via stations for segments >1000km
