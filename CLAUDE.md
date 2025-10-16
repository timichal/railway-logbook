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
- `npm run prepareData` - Complete data preparation pipeline (filters rail features, converts to GeoJSON, and prunes data)
- `npm run populateDb` - Loads processed GeoJSON data into PostgreSQL database and initializes vector tile functions

### Database Operations
- `docker-compose up -d postgres` - Start PostgreSQL database with PostGIS
- `npm run populateDb` - Load GeoJSON data into database tables and initialize vector tile functions

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
1. **Filter** (`osmium-scripts/filterRailFeatures.sh`) - Applies OpenRailwayMap filter to extract railway features
2. **Convert** (`osmium-scripts/convertToGeojson.sh`) - Converts filtered OSM data to GeoJSON format
3. **Prune** (`src/scripts/pruneData.ts`) - Applies custom filters to remove unwanted features (subways, etc.)
4. **Database Load** (`src/scripts/populateDb.ts`) - Imports processed data into PostgreSQL with user separation

### 3. Database Architecture
- **PostgreSQL 16 with PostGIS** - Spatial database for geographic data
- **Data Separation**: Objective railway data vs. user-specific annotations
- **Tables**:
  - `users` - User accounts and authentication (email as username, password field for bcrypt hashes)
  - `stations` - Railway stations (Point features from OSM with PostGIS coordinates)
  - `railway_routes` - Railway lines with auto-generated track_id (SERIAL), description, usage_types array, primary_operator, length_km, and PostGIS geometry
  - `railway_parts` - Raw railway segments from OSM data (used for admin route creation)
  - `user_railway_data` - User-specific ride history (last_ride dates) and personal notes
- **Spatial Indexing**: GIST indexes for efficient geographic queries
- **Auto-generated IDs**: track_id uses PostgreSQL SERIAL for automatic ID generation

### 4. Frontend Application
- **Next.js 15** with React 19 - Modern web application framework
- **MapLibre GL JS** - Vector tile rendering for high-performance map visualization
- **Martin Tile Server** - PostGIS vector tile server (port 3001) serving railway_routes, railway_parts, and stations
- **Server Actions** - Type-safe database operations (`src/lib/railway-actions.ts`)
- **Dynamic Styling** - Route colors based on user data (green=visited, crimson=unvisited), weight based on usage type
- **Usage Enum Translation** - Frontend translates database enum numbers to Czech strings
- **Connection Pooling** - PostgreSQL pool for database performance
- **Shared Map Utilities** - Common map initialization and configuration in `src/lib/map/`

### 5. Admin System Architecture
- **Admin Access Control** - Restricted to user_id=1 with authentication checks
- **Vector Tile Architecture**:
  - `railway_routes` and `railway_parts` served via Martin tile server (PostGIS → MVT tiles)
  - Efficient rendering of large datasets through tile-based loading
  - MapLibre GL JS handles tile caching and viewport management automatically
- **Interactive Features**:
  - Click railway parts to select start/end points for route creation
  - Click railway routes to view/edit details
  - Route preview with geometry visualization
  - Hover effects on railway parts
- **Route Management**: Create, edit, update, and delete railway routes (track_id is auto-generated)
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
  - `route-save-actions.ts` - Server actions for saving new routes
  - `route-delete-actions.ts` - Server actions for deleting routes
  - `enums.ts` - Usage patterns and operator definitions
  - `types.ts` - Core type definitions
  - `src/lib/map/` - Shared map utilities
    - `index.ts` - Constants, layer factories, closeAllPopups utility
    - `hooks/useMapLibre.ts` - Base hook for MapLibre initialization
- `src/scripts/` - Data processing scripts
  - `pruneData.ts` - Filters unwanted railway features (removes subways, etc.)
  - `populateDb.ts` - Database loading script (loads stations, railway_parts, and railway_routes)

### OSM Processing Scripts (`osmium-scripts/`)
- `prepare.sh` - Master script that orchestrates the entire pipeline
- `filterRailFeatures.sh` - Applies OpenRailwayMap filter using osmium tags-filter
- `convertToGeojson.sh` - Converts OSM PBF to GeoJSON format

### Shared Libraries (`src/lib/`)
- `types.ts` - Core type definitions for GeoJSON features and railway data
- `enums.ts` - Usage patterns (Regular, OnceDaily, Seasonal, etc.) and operators (ČD, ÖBB, etc.)
- `db.ts` - Database connection pool and utilities
- `railway-actions.ts` - Server actions for type-safe database operations

### Database Schema
- `database/init/01-schema.sql` - PostgreSQL schema with PostGIS spatial indexes
- Contains tables for users, stations, railway_routes, railway_parts, and user_railway_data

### Configuration Files
- `eslint.config.mjs` - ESLint configuration
- `postcss.config.mjs` - PostCSS configuration for Tailwind
- `public/` - Static assets served by Next.js

### Output Data (`data/`)
- `<country>.tmp.osm.pbf` - Downloaded OSM data
- `<country>-rail.tmp.osm.pbf` - Filtered railway data
- `<country>-rail.tmp.geojson` - Converted to GeoJSON
- `<country>-pruned.geojson` - Custom filtered data (ready for database loading)

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

### Admin Route Creation
- Admin interface allows creating new routes by clicking railway parts on the map
- Routes are built by selecting start/end points from `railway_parts`
- Database pathfinding (PostGIS spatial queries) finds connecting segments within 50km
- Route length is automatically calculated using ST_Length with geography cast
- track_id is auto-generated using PostgreSQL SERIAL

### User Progress Tracking
- User-specific data stored in `user_railway_data` table
- Progress calculated from `length_km` column in `railway_routes`
- Progress stats show completed/total km and percentage
- Frontend displays: green for visited routes, crimson for unvisited routes
