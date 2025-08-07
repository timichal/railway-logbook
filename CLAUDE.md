# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a complete OSM (OpenStreetMap) railway data processing and visualization system that fetches, processes, and serves railway data from Czech Republic and Austria. The project consists of three main components:

1. **Data Processing Pipeline** - Converts OpenStreetMap data into structured GeoJSON format
2. **Database System** - PostgreSQL/PostGIS database for storing railway routes and user data
3. **Frontend Application** - Next.js web application with interactive Leaflet maps

## Core Commands

### Data Processing Pipeline
- `npm run prepareData` - Complete data preparation pipeline (downloads OSM data, filters rail features, merges countries, converts to GeoJSON, and prunes data)
- `npm run check <country_code>` - Validates railway definitions for a country (e.g., `npm run check cz`)
- `npm run apply <country_code>` - Applies railway definitions to create combined GeoJSON (e.g., `npm run apply cz`)
- `npm run merge` - Combines all `-combined.geojson` files into `merged-only.geojson`
- `npm run populateDb` - Loads processed GeoJSON data into PostgreSQL database

### Database Operations
- `docker-compose up -d postgres` - Start PostgreSQL database with PostGIS
- `npm run populateDb` - Load GeoJSON data into database tables

### Frontend Development
- `cd frontend && npm run dev` - Start Next.js development server with Turbopack
- `cd frontend && npm run build` - Build production frontend
- `cd frontend && npm run start` - Start production frontend server

### Prerequisites
- **Osmium Tool** required for data processing: `conda install conda-forge::osmium-tool`
- **TypeScript execution**: Uses `tsx` for running TypeScript files directly
- **Docker** for PostgreSQL database: `docker-compose up -d postgres`
- **Node.js** for both root and frontend projects

## System Architecture

### Complete Data Flow
```
OSM PBF Files → Filtered OSM → GeoJSON → Combined Routes → Database → Frontend Map
     ↓              ↓           ↓           ↓             ↓           ↓
Raw Railway    Railway Only  Pruned Data  Applied     PostgreSQL   Interactive
   Data         Features     + Stations   Definitions   + PostGIS    Leaflet Map
```

### 1. Data Sources
- OpenStreetMap data from https://download.geofabrik.de/europe.html
- Country-specific OSM PBF files (stable dumps from 2025-01-01)
- Railway definitions in TypeScript files (`definitions/*.ts`)

### 2. Processing Pipeline
1. **Download** (`osmium-scripts/download.sh`) - Downloads OSM PBF data for specified countries
2. **Filter** (`osmium-scripts/filterRailFeatures.sh`) - Applies OpenRailwayMap filter to extract railway features
3. **Merge** (`osmium-scripts/merge.sh`) - Combines data from multiple countries for cross-border routes
4. **Convert** (`osmium-scripts/convertToGeojson.sh`) - Converts filtered OSM data to GeoJSON format
5. **Prune** (`scripts/pruneData.ts`) - Applies custom filters to remove unwanted features (subways, etc.)
6. **Apply Definitions** (`scripts/applyRailwayDefinitions.ts`) - Merges railway segments according to definitions
7. **Final Merge** (`scripts/mergeCountryFiles.ts`) - Combines all country data into single output
8. **Database Load** (`scripts/populateDb.ts`) - Imports processed data into PostgreSQL with user separation

### 3. Database Architecture
- **PostgreSQL 16 with PostGIS** - Spatial database for geographic data
- **Data Separation**: Objective railway data vs. user-specific annotations
- **Tables**:
  - `users` - User accounts and authentication (email as username, password field for future auth)
  - `stations` - Railway stations (Point features from OSM with PostGIS coordinates)
  - `railway_routes` - Railway lines with description, usage_types array, primary_operator, and PostGIS geometry
  - `railway_parts` - Raw railway segments from OSM data (original line data before route definitions applied)
  - `user_railway_data` - User-specific ride history (last_ride dates) and personal notes
- **Spatial Indexing**: GIST indexes for efficient geographic queries

### 4. Frontend Application
- **Next.js 15** with React 19 - Modern web application framework
- **Leaflet** - Interactive mapping library for route visualization with zoom-based station visibility
- **Server Actions** - Type-safe database operations (`railway-actions.ts`)
- **Dynamic Styling** - Route colors based on user data (green=visited, crimson=unvisited), weight based on usage type
- **Usage Enum Translation** - Frontend translates database enum numbers to Czech strings
- **Connection Pooling** - PostgreSQL pool for database performance
- **Admin Interface** - Admin-only page (`/admin`) for viewing raw railway parts with performance optimizations

### 5. Admin System Architecture
- **Admin Access Control** - Restricted to user_id=1 with authentication checks
- **Railway Parts Visualization** - Real-time map display of raw OSM railway segments
- **Performance Optimization**:
  - Viewport-based loading (single DB query per viewport change)
  - 5000 feature cache limit with FIFO eviction strategy
  - Current viewport features always displayed, cached features fill background
  - Hover effects (railway parts turn red on mouse hover)
- **Data Sources**: Uses `railway_parts` table populated from `cz-pruned.geojson`

## Key File Structure

### Root Level
- `package.json` - Main project dependencies and scripts
- `docker-compose.yml` - PostgreSQL database configuration
- `tsconfig.json` - TypeScript configuration for processing scripts
- `enums.ts` - Usage patterns and operator definitions
- `types.ts` - Core type definitions for the data processing pipeline

### Processing Scripts (`scripts/`)
- `checkRailwayDefinitions.ts` - Validates railway definitions against OSM data
- `applyRailwayDefinitions.ts` - Combines railway segments into complete routes
- `mergeCountryFiles.ts` - Merges multiple country datasets
- `pruneData.ts` - Filters unwanted railway features (removes subways, keeps rail/light_rail)
- `mergeCoordinateLists.ts` - Utility for combining coordinate arrays
- `populateDb.ts` - Database loading script (TypeScript with proper type safety)

### OSM Processing Scripts (`osmium-scripts/`)
- `prepare.sh` - Master script that orchestrates the entire pipeline
- `download.sh` - Downloads OSM PBF files from Geofabrik (stable 2025-01-01 dumps)
- `filterRailFeatures.sh` - Applies OpenRailwayMap filter using osmium tags-filter
- `merge.sh` - Combines multiple country datasets for cross-border routes
- `convertToGeojson.sh` - Converts OSM PBF to GeoJSON format

### Data Definitions
- `definitions/cz.ts` - Czech railway route definitions (~265KB file with ~1000+ routes)
- `definitions/at.ts` - Austrian railway route definitions  
- `definitions/at-cz.ts` - Cross-border route definitions

### Type System
- `types.ts` - Core type definitions for GeoJSON features and railway data
- `enums.ts` - Usage patterns (Regular, OnceDaily, Seasonal, etc.) and operators (ČD, ÖBB, etc.)

### Database Schema
- `database/init/01-schema.sql` - PostgreSQL schema with PostGIS spatial indexes
- Contains tables for users, stations, railway_routes, railway_parts, and user_railway_data

### Frontend Application (`frontend/`)
- `src/app/` - Next.js App Router pages (layout.tsx, page.tsx)
  - `src/app/admin/` - Admin-only pages (page.tsx)
  - `src/app/api/admin/tiles/[...tile]/` - Tile-based API endpoints (legacy, unused)
- `src/components/` - React components (MapWrapper.tsx, RailwayMap.tsx, AdminMap.tsx)
  - `AdminMap.tsx` - High-performance railway parts visualization with caching
  - `AdminMapWrapper.tsx` - Wrapper component for admin map
- `src/lib/` - Database utilities and server actions
  - `db.ts` - PostgreSQL connection pool
  - `railway-actions.ts` - Server actions for database queries (includes getRailwayPartsByBounds)
  - `types.ts` - Frontend type definitions

### Output Data (`data/`)
- `<country>.tmp.osm.pbf` - Downloaded OSM data
- `<country>-rail.tmp.osm.pbf` - Filtered railway data
- `<country>-rail.tmp.geojson` - Converted to GeoJSON
- `<country>-pruned.geojson` - Custom filtered data
- `<country>-combined.geojson` - Routes with definitions applied
- `merged-only.geojson` - Final combined dataset for database loading

## Railway Definition Structure

Railway definitions in `definitions/` files follow this schema:
```typescript
{
  from: string,           // Starting station
  to: string,             // Ending station  
  local_number: string,   // Railway line number
  description?: string,   // Optional custom description (new field)
  usage: Usage[],         // Service frequency pattern (stored as enum numbers in DB)
  primary_operator: Operator, // Main railway operator
  ways: string,           // Semicolon-separated OSM way IDs
  custom?: {              // Optional metadata
    last_ride?: string,   // Date of last service
    note?: string         // Additional notes
  }
}
```

## Development Notes

### TypeScript Configuration
- Uses ESNext modules with strict type checking
- Execute scripts with `tsx` (no build step required)

### Data Processing
- Custom filters applied in `pruneData.ts` remove subway and unwanted railway types
- Cross-border routes require merged datasets from multiple countries
- Railway definitions use OSM way IDs to reconstruct complete routes from segmented data
- `populateDb.ts` uses batch inserts for performance and populates:
  - `stations` and `railway_parts` from `cz-pruned.geojson`
  - `railway_routes` from `merged-only.geojson`

### Output Format
Final GeoJSON includes custom properties for visualization:
- `track_id` - Unique identifier for railway routes
- `usage` - Usage enum array (stored directly in properties, not generated from description)
- `primary_operator` - Operator stored directly in properties
- `description` - Custom description field when provided in definitions
- `last_ride`/`note` - User data stored directly in properties when available
- Dynamic styling: Frontend generates colors (green/crimson) based on user visit history
- Usage enum translation: Database stores enum numbers, frontend translates to Czech strings
