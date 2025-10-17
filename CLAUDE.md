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
- `npm run prepareData -- <version>` - Complete data preparation pipeline (downloads OSM data, filters rail features, converts to GeoJSON, and prunes data)
  - Required argument: OSM data version (format: YYMMDD)
  - Example: `npm run prepareData -- 251016`
  - Output: `./data/europe-pruned-<version>.geojson`
- `npm run populateDb <filepath>` - Loads processed GeoJSON data into PostgreSQL database and initializes vector tile functions
  - Required argument: path to GeoJSON file
  - Example: `npm run populateDb ./data/europe-pruned-251016.geojson`
- `npm run updateDb <filepath>` - Reloads railway data and recalculates all routes (marks invalid routes when pathfinding fails)
  - Required argument: path to GeoJSON file
  - Example: `npm run updateDb ./data/europe-pruned-251016.geojson`

### Database Operations
- `docker-compose up -d postgres` - Start PostgreSQL database with PostGIS
- `npm run exportRoutes` - Export railway_routes table to JSON file (saved to `data/railway_routes_YYYY-MM-DD.json`)
- `npm run importRoutes <filename>` - Import railway_routes from JSON file (e.g., `npm run importRoutes railway_routes_2025-01-15.json`)

### Frontend Development
- `npm run dev` - Start Next.js development server with Turbopack
- `npm run build` - Build production application
- `npm run start` - Start production server
- `npm run lint` - Run ESLint checks

### Prerequisites
- **Osmium Tool** required for data processing: `conda install conda-forge::osmium-tool`
- **TypeScript execution**: Uses `tsx` for running TypeScript files directly
- **Docker** for PostgreSQL database: `docker-compose up -d postgres`
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
- **Next.js 15** with React 19 - Modern web application framework
- **MapLibre GL JS** - Vector tile rendering for high-performance map visualization
- **Martin Tile Server** - PostGIS vector tile server (port 3001) serving railway_routes, railway_parts, and stations
- **Server Actions** - Type-safe database operations (`src/lib/railway-actions.ts`)
- **Dynamic Styling** - Three-way route colors based on user data (dark green=fully completed, dark orange=partial, crimson=unvisited), weight based on usage type (thinner for Special)
- **Usage Type Display** - Frontend displays enum numbers (0=Regular, 1=Seasonal, 2=Special) in popups
- **Connection Pooling** - PostgreSQL pool for database performance
- **Shared Map Utilities** - Common map initialization and configuration in `src/lib/map/`

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
- `src/app/` - Next.js App Router pages (layout.tsx, page.tsx)
  - `src/app/admin/` - Admin-only pages (page.tsx)
- `src/components/` - React components
  - `VectorRailwayMap.tsx` - User-facing map with ride tracking
  - `VectorMapWrapper.tsx` - Wrapper for user map
  - `VectorAdminMap.tsx` - Admin map for route management
  - `VectorAdminMapWrapper.tsx` - Wrapper for admin map
  - `AdminPageClient.tsx` - Admin page container with state management
  - `AdminSidebar.tsx` - Admin interface sidebar with route creation/editing forms
  - `AdminRoutesTab.tsx` - Route list and edit interface
- `src/lib/` - Shared utilities, types, and database operations
  - `db.ts` - PostgreSQL connection pool
  - `railway-actions.ts` - Server actions for database queries
  - `route-save-actions.ts` - Server actions for creating/updating routes (admin-only)
  - `route-delete-actions.ts` - Server actions for deleting routes (admin-only)
  - `db-path-actions.ts` - Database pathfinding for route creation (admin-only)
  - `railway-parts-actions.ts` - Fetch railway parts by IDs (admin-only)
  - `coordinate-utils.ts` - Shared coordinate utilities (mergeLinearChain, coordinatesToWKT)
  - `constants.ts` - Usage type options (Regular/Seasonal/Special)
  - `types.ts` - Core type definitions
  - `src/lib/map/` - Shared map utilities
    - `index.ts` - Constants, layer factories, closeAllPopups utility
    - `hooks/useMapLibre.ts` - Base hook for MapLibre initialization
- `src/scripts/` - Data processing scripts
  - `pruneData.ts` - Filters unwanted railway features (removes subways, etc.)
  - `populateDb.ts` - Database loading script (loads stations and railway_parts)
  - `updateDb.ts` - Reloads railway data and recalculates all routes
  - `exportRoutes.ts` - Export railway_routes table to JSON file
  - `importRoutes.ts` - Import railway_routes from JSON file
  - `src/scripts/lib/` - Shared script utilities
    - `loadRailwayData.ts` - Shared data loading logic for populateDb and updateDb
    - `railwayPathFinder.ts` - Shared BFS pathfinding class for route creation/recalculation

### OSM Processing Scripts (`osmium-scripts/`)
- `prepare.sh` - Unified pipeline script that downloads OSM data, filters rail features, and converts to GeoJSON

### Shared Libraries (`src/lib/`)
- `types.ts` - Core type definitions for GeoJSON features and railway data
- `constants.ts` - Usage type options (Regular=0, Seasonal=1, Special=2)
- `db.ts` - Database connection pool and utilities
- `railway-actions.ts` - Server actions for type-safe database operations
- `route-save-actions.ts` - Admin-only route creation/update with security checks
- `route-delete-actions.ts` - Admin-only route deletion with security checks
- `db-path-actions.ts` - Admin-only database pathfinding using RailwayPathFinder
- `railway-parts-actions.ts` - Admin-only railway parts fetching
- `coordinate-utils.ts` - Shared coordinate utilities (mergeLinearChain algorithm, coordinatesToWKT converter)

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
- `railway_routes_YYYY-MM-DD.json` - Exported route data (from `npm run exportRoutes`)

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
- Shared pathfinding (`RailwayPathFinder` class) uses BFS with PostGIS spatial queries within 50km
- Route length is automatically calculated using ST_Length with geography cast
- track_id is auto-generated using PostgreSQL SERIAL
- Routes store starting_part_id and ending_part_id for recalculation after OSM updates
- `saveRailwayRoute` handles both INSERT (new routes) and UPDATE (edit geometry) with optional trackId parameter
- Uses `mergeLinearChain` algorithm to properly order and connect coordinate sublists

### Database Updates and Route Recalculation
- `npm run updateDb` reloads railway_parts from pruned GeoJSON and recalculates all routes
- Recalculation uses stored starting_part_id and ending_part_id with shared `RailwayPathFinder`
- Fetches railway part geometries and uses shared `mergeLinearChain` for proper coordinate ordering (same as route creation)
- Routes that can't be recalculated are marked with is_valid=false and error_message
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
