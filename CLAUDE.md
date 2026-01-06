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
- `npm run verifyRouteData` - Recalculate all railway routes and mark invalid routes (verifies route validity without reloading map data)
- `npm run applyVectorTiles` - Apply/update vector tile functions from `database/init/02-vector-tiles.sql` (useful after modifying tile queries)
- `npm run addAdminNotes` - Run migration to create admin_notes table (one-time setup)
  - Creates table with id, coordinate (PostGIS POINT), text, created_at, updated_at
  - Adds spatial index and auto-update trigger
  - Safe to run multiple times (checks if table exists)
- `npm run addScenicField` - Run migration to add scenic field to railway_routes table (one-time setup)
  - Adds scenic BOOLEAN column with default FALSE
  - Safe to run multiple times (uses IF NOT EXISTS)
- `npm run markAllRoutesInvalid` - Mark all routes as invalid for rechecking (sets is_valid=false and error_message='Route recheck')
  - Useful for forcing recalculation of all routes
  - Run `verifyRouteData` after to recalculate
- `npm run listStations` - List all unique station names from railway_routes table (sorted alphabetically)
  - Debugging utility for viewing station data
  - Combines from_station and to_station columns
- `npm run exportRouteData` - Export railway_routes, user_trips (user_id=1), and admin_notes to SQL dump using Docker (saved to `data/railway_data_YYYY-MM-DD.sql`)
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
- `npx tsc --noEmit` - Run TypeScript type checking without building

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
4. **Database Load** (`src/scripts/importMapData.ts`) - Imports processed data into PostgreSQL with user separation

### 3. Database Architecture
- **PostgreSQL 16 with PostGIS** - Spatial database for geographic data
- **Data Separation**: Objective railway data vs. user-specific annotations
- **Tables**:
  - `users` - User accounts and authentication (email as username, password field for bcrypt hashes)
  - `stations` - Railway stations (Point features from OSM with PostGIS coordinates)
  - `railway_routes` - Railway lines with auto-generated track_id (SERIAL), from_station, to_station, track_number, description, usage_type (0=Regular, 1=Special), frequency (array of tags: Daily, Weekdays, Weekends, Once a week, Seasonal), link (external URL), scenic (BOOLEAN flag for particularly scenic routes), PostGIS geometry, length_km, start_country (ISO 3166-1 alpha-2), end_country (ISO 3166-1 alpha-2), **starting_coordinate (POINT)**, **ending_coordinate (POINT)**, is_valid flag, and error_message
  - `railway_parts` - Raw railway segments from OSM data (used for admin route creation and pathfinding)
  - `user_trips` - User-specific trip records; supports multiple trips per route with id, user_id, track_id, date, note, partial flag, created_at, updated_at; no UNIQUE constraint allows logging the same route multiple times
  - `user_preferences` - User preferences for country filtering; stores selected_countries as TEXT[] array of ISO country codes (defaults: CZ, SK, AT, PL, DE, LT, LV, EE)
  - `admin_notes` - Admin-only map notes with id, coordinate (PostGIS POINT), text, created_at, updated_at; auto-updates timestamp on edit
- **Spatial Indexing**: GIST indexes for efficient geographic queries
- **Auto-generated IDs**: track_id uses PostgreSQL SERIAL for automatic ID generation
- **Coordinate-Based Routing**: Routes store exact starting_coordinate and ending_coordinate (exact click points on railway parts) for precise recalculation; is_valid flag marks routes that can't be recalculated after OSM updates
- **Multiple Trips Support**: user_trips table allows users to log the same route multiple times (e.g., different dates); frontend displays most recent trip for route coloring
- **Country Tracking**: Routes automatically store start_country and end_country (2-letter ISO codes) determined from route geometry; uses @rapideditor/country-coder for worldwide boundary detection

### 4. Frontend Application
- **Next.js 15** with React 19 - Modern web application framework with App Router
- **MapLibre GL JS** - Vector tile rendering for high-performance map visualization
- **Martin Tile Server** - PostGIS vector tile server (port 3001) serving railway_routes, railway_parts, and stations as MVT tiles
- **Server Actions** - Type-safe database operations with automatic serialization
- **Authentication** - Email/password authentication with bcrypt, session management
- **Dynamic Styling** - Three-way route colors based on user data (dark green=fully completed, dark orange=partial, crimson=unvisited), weight based on usage type (thinner for Special), amber outline effect for scenic routes
- **Badge-Style Tooltips** - Hover popups display color-coded badges: usage type (blue=Regular, purple=Special), frequency tags (green badges), and scenic flag (amber badge)
- **Connection Pooling** - PostgreSQL pool for database performance
- **Shared Map Utilities** - Modular map initialization, hooks, interactions, and styling in `src/lib/map/`
- **Station Search** - Diacritic-insensitive autocomplete search (requires PostgreSQL `unaccent` extension); floating search box in top-right
- **Geolocation Control** - Built-in "show current location" button with high-accuracy positioning and user heading
- **Unified User Sidebar** - Left-side resizable tabbed sidebar (400px-1200px) with five sections: Route Logger, Journey Planner, Country Settings & Stats, How To Use, and Railway Notes (see dedicated section below)
- **Article Tabs** - "How To Use" and "Railway Notes" buttons in navbar open full-screen article tabs in sidebar with close button to return to Route Logger

### 5. Admin System Architecture
- **Admin Access Control** - Restricted to user_id=1 with server-side authentication checks in all admin actions
- **Security**: All admin operations (create, update, delete routes, pathfinding, notes) require `user.id === 1` check
- **Vector Tile Architecture**:
  - `railway_routes`, `railway_parts`, and `admin_notes` served via Martin tile server (PostGIS → MVT tiles)
  - Efficient rendering of large datasets through tile-based loading
  - MapLibre GL JS handles tile caching and viewport management automatically
- **Interactive Features**:
  - Click railway parts to select exact coordinates for start/end points
  - Click anywhere on a railway part captures the precise GPS coordinate
  - Click railway routes to view/edit details
  - Route preview with geometry visualization
  - Hover effects on railway parts and notes
  - **Right-click to create/edit notes** - Right-click anywhere on map to create note, right-click on existing note to edit
- **Route Management**: Create, edit geometry, update, and delete railway routes (track_id is auto-generated)
- **Route Validity Display**: Invalid routes (is_valid=false) shown in grey when unselected, with alert banner in edit panel
- **Edit Geometry Feature**: Allows fixing invalid routes by selecting new start/end coordinates with same pathfinding mechanism
- **Admin Notes System**:
  - Right-click map to create notes at any location
  - Right-click existing notes to edit or delete
  - Notes displayed as yellow/amber circles on map
  - Popup interface with text field, save, delete, and close buttons
  - Keyboard shortcuts: Ctrl+Enter to save, Escape to close
  - Auto-refresh map after create/update/delete
  - Toast notifications for all operations
- **Coordinate-Based Routing**:
  - Routes defined by exact start/end coordinates (stored as PostGIS POINT geometries)
  - Click anywhere on a railway part to set route boundaries
  - Pathfinding automatically:
    - Finds which railway part contains each coordinate
    - Truncates edge parts from click point to connection
    - Builds complete route geometry with proper ordering
  - Eliminates need for railway part splitting - click precision replaces segmentation
  - Route recalculation uses stored coordinates to rebuild geometry after OSM updates
  - Pathfinding tolerance: 50m to find nearest part vertex
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
- `page.tsx` - Main user map page (server component that renders MainLayout with user data and preferences)
- `login/page.tsx` - Login page
- `register/page.tsx` - Registration page
- `admin/page.tsx` - Admin route management page (user_id=1 only)

#### Components (`src/components/`)

**User Map Components:**
- `MainLayout.tsx` - Client component wrapper managing activeTab state and resizable sidebar (400px-1200px)
- `VectorRailwayMap.tsx` - Main user map with unified sidebar, station search, progress stats, and resizer handle
- `VectorMapWrapper.tsx` - Wrapper for user map with authentication; passes server-side user preferences to avoid flash
- `UserSidebar.tsx` - Unified tab-based sidebar (Route Logger / Journey Planner / Country Settings & Stats / How To Use / Railway Notes)
- `SelectedRoutesList.tsx` - Route Logger tab: route selection list and bulk logging form
- `JourneyPlanner.tsx` - Journey Planner tab: pathfinding between stations (from → via → to with drag-and-drop reordering); stations clickable on map
- `CountriesStatsTab.tsx` - Country Settings & Stats tab: country filter checkboxes (CZ, SK, AT, PL, DE, LT, LV, EE) with per-country stats and total
- `HowToUseArticle.tsx` - Article tab with header and close button (empty content area for user instructions)
- `RailwayNotesArticle.tsx` - Article tab with header and close button (empty content area for railway notes)
- `TripRow.tsx` - Individual trip row in Manage Trips modal (inline editing/deleting)

**Admin Map Components:**
- `VectorAdminMap.tsx` - Admin map for route management with railway parts selection and notes system (right-click to create/edit notes)
- `VectorAdminMapWrapper.tsx` - Wrapper for admin map
- `AdminPageClient.tsx` - Admin page container with state management
- `AdminSidebar.tsx` - Tab-based sidebar (Create Route / Routes List)
- `AdminCreateRouteTab.tsx` - Route creation interface with start/end point selection
- `AdminRoutesTab.tsx` - Route list with search and edit functionality
- `RoutesList.tsx` - Paginated route table with validity indicators
- `RouteEditForm.tsx` - Form for editing route metadata (from/to/track/description/usage/scenic/frequency/link)
- `NotesPopup.tsx` - Popup component for creating/editing admin notes (text field, save/delete buttons, keyboard shortcuts)

**Shared Components:**
- `Navbar.tsx` - Navigation bar with title, login/logout, and article buttons ("How To Use" and "Railway Notes")
- `LoginForm.tsx` - Login form with email/password
- `RegisterForm.tsx` - Registration form

#### Library (`src/lib/`)

**Database & Actions:**
- `db.ts` - PostgreSQL connection pool (exports pool as default)
- `dbConfig.ts` - Database configuration utilities
- `userActions.ts` - User-facing server actions (search stations, get GeoJSON data, update/delete user trips, get progress with country filtering, bulk update routes with firstPartial/lastPartial)
- `userPreferencesActions.ts` - User preferences management (get/update selected countries, ensure defaults)
- `adminRouteActions.ts` - Admin-only route creation/update/deletion with security checks and automatic country detection
- `adminMapActions.ts` - Admin-only coordinate-based pathfinding (`findRailwayPathFromCoordinates`) and railway parts fetching by IDs
- `adminNotesActions.ts` - Admin-only notes CRUD operations (getAllAdminNotes, getAdminNote, createAdminNote, updateAdminNote, deleteAdminNote)
- `routePathFinder.ts` - Route-level pathfinding for journey planner (user-facing, uses station name matching)
- `authActions.ts` - Authentication actions (login, register, logout, getUser)

**Utilities:**
- `types.ts` - Core TypeScript type definitions (Station, GeoJSONFeature, RailwayRoute, UserTrip, UserPreferences, etc.)
- `constants.ts` - Usage type options (Regular=0, Special=1), frequency options (Daily, Weekdays, Weekends, Once a week, Seasonal), UsageType type export
- `coordinateUtils.ts` - Coordinate utilities (mergeLinearChain algorithm, coordinatesToWKT)
- `countryUtils.ts` - Country detection from coordinates using @rapideditor/country-coder (worldwide boundary detection, ISO 3166-1 alpha-2 codes)

#### Map Library (`src/lib/map/`)

**Core:**
- `index.ts` - Map constants (MAPLIBRE_STYLE, MARTIN_URL), layer factories (createRailwayRoutesSource/Layer, createScenicRoutesOutlineLayer, createStationsSource/Layer), closeAllPopups utility
- `mapState.ts` - Shared map state management

**Hooks:**
- `hooks/useMapLibre.ts` - Base hook for MapLibre GL initialization with sources, layers, navigation controls, and geolocation control
- `hooks/useRouteEditor.ts` - Hook for route editing functionality (manage trips modal state, add/update/delete trips, progress tracking with country filtering, map refresh)
- `hooks/useStationSearch.ts` - Hook for station search with debouncing and keyboard navigation
- `hooks/useRouteLength.ts` - Hook for calculating route length display

**Interactions:**
- `interactions/userMapInteractions.ts` - User map click handlers (route click to add to selection, badge-style hover popups)
- `interactions/adminMapInteractions.ts` - Admin map click handlers (coordinate capture from railway parts, route editing, badge-style hover popups)

**Utilities:**
- `utils/userRouteStyling.ts` - User route color/width expressions (three-way colors: dark green=completed, dark orange=partial, crimson=unvisited; scenic routes use same colors with outline layer)
- `utils/tooltipFormatting.ts` - Shared tooltip badge formatting (usage type, frequency, scenic badges)
- `utils/distance.ts` - Distance calculation utilities

#### Scripts (`src/scripts/`)

**Data Processing:**
- `pruneData.ts` - Filters unwanted railway features (removes subways, etc.)
- `importMapData.ts` - Database loading script (loads stations and railway_parts, recalculates existing routes)
- `verifyRouteData.ts` - Recalculates all railway routes and marks invalid routes (verification only, doesn't reload map data)
- `addAdminNotes.ts` - Migration script to create admin_notes table with spatial index and auto-update trigger
- `markAllRoutesInvalid.ts` - Marks all routes as invalid for rechecking (utility script)
- `listStations.ts` - Lists all unique station names from railway_routes (debugging utility)
- `exportRoutes.ts` - Export railway_routes table to JSON file
- `importRoutes.ts` - Import railway_routes from JSON file

**Script Utilities (`src/scripts/lib/`):**
- `loadRailwayData.ts` - Shared data loading logic
- `railwayPathFinder.ts` - Shared BFS pathfinding class for admin route creation and recalculation

### OSM Processing Scripts (`osmium-scripts/`)
- `prepare.sh` - Unified pipeline script that downloads OSM data, filters rail features, and converts to GeoJSON

### Database Schema
- `database/init/01-schema.sql` - PostgreSQL schema with PostGIS spatial indexes, route validity tracking fields, country tracking (start_country, end_country), and user_preferences table
- `database/init/02-vector-tiles.sql` - Vector tile functions with country filtering support and admin notes:
  - `railway_routes_tile` - Shows routes at all zoom levels with country filtering via selected_countries query param; includes start_country and end_country in tile attributes
  - `railway_parts_tile` - Zoom-based filtering for raw OSM segments
  - `stations_tile` - Stations visible at zoom 10+
  - `admin_notes_tile` - Admin notes visible at all zoom levels (admin-only)
  - Web Mercator (EPSG:3857) geometry columns and sync triggers for all spatial tables including admin_notes
- Contains tables for users, stations, railway_routes (with frequency, link, scenic flag, start_country, end_country, starting_coordinate, ending_coordinate, is_valid, error_message), railway_parts, user_trips (supports multiple trips per route), user_preferences (selected_countries array), and admin_notes (coordinate, text, timestamps)

### Configuration Files
- `eslint.config.mjs` - ESLint configuration
- `postcss.config.mjs` - PostCSS configuration for Tailwind
- `public/` - Static assets served by Next.js

### Output Data (`data/`)
- `<country>.tmp.osm.pbf` - Downloaded OSM data
- `<country>-rail.tmp.osm.pbf` - Filtered railway data
- `<country>-rail.tmp.geojson` - Converted to GeoJSON
- `<country>-pruned.geojson` - Custom filtered data (ready for database loading)
- `railway_data_YYYY-MM-DD.sql` - Exported railway_routes, user_trips, and admin_notes (from `npm run exportRouteData`)

## Development Workflow

### Type Checking
- **ALWAYS run `npx tsc --noEmit` after completing a batch of related code changes** to verify type correctness
- Do NOT run full builds (`npm run build`) unless specifically requested by the user
- Type checking is sufficient for catching most issues and is much faster than full builds
- Running type checks frequently prevents accumulation of type errors

## Development Notes

### TypeScript Configuration
- Uses ESNext modules with strict type checking
- Execute scripts with `tsx` (no build step required)

### Data Processing
- Custom filters applied in `pruneData.ts` remove subway and unwanted railway types
- `src/scripts/importMapData.ts` uses batch inserts for performance and:
  - Executes database initialization SQL files (vector tile functions, Web Mercator columns)
  - Populates `stations` and `railway_parts` from `cz-pruned.geojson`
  - Admin users create `railway_routes` manually via the web interface

### Admin Route Creation and Management
- Admin interface allows creating new routes by clicking exact coordinates on railway parts
- **Coordinate-Based System**: Click anywhere on a railway part to capture precise GPS coordinates (no part splitting needed)
- Routes are built by selecting start/end coordinates, stored as PostGIS POINT geometries
- Shared pathfinding (`RailwayPathFinder` class):
  - `findPathFromCoordinates()` method accepts exact coordinates
  - Uses BFS with PostGIS spatial queries (50km → 100km → 220km progressive buffer)
  - Automatically finds which railway parts contain the coordinates (50m tolerance)
  - Truncates edge parts from click point to connection
  - Returns properly ordered coordinate chain
- Route length is automatically calculated using ST_Length with geography cast
- **Country Detection**: start_country and end_country automatically determined from route geometry using @rapideditor/country-coder (worldwide boundary detection)
- track_id is auto-generated using PostgreSQL SERIAL
- Routes store `starting_coordinate` and `ending_coordinate` for recalculation after OSM updates
- `saveRailwayRoute` handles both INSERT (new routes) and UPDATE (edit geometry) with coordinate parameters
- Uses `mergeLinearChain` algorithm to properly order and connect coordinate sublists

### Database Updates and Route Recalculation
- `npm run importMapData` automatically reloads railway_parts from pruned GeoJSON and recalculates all existing routes
- If no routes exist (initial setup), recalculation is skipped
- Recalculation uses stored `starting_coordinate` and `ending_coordinate` with `findPathFromCoordinates()`
- Pathfinding automatically handles coordinate-to-part mapping and edge truncation
- Routes that can't be recalculated are marked with is_valid=false and error_message (e.g., "No path found", "Coordinate no longer on railway network")
- Routes with distance mismatches (>0.1 km AND >1% difference) are marked invalid with detailed error message
- Invalid routes displayed in grey on admin map (orange when selected)
- Admin can fix invalid routes using "Edit Route Geometry" to select new start/end coordinates

### User Progress Tracking
- User-specific data stored in `user_trips` table with date, note, and partial fields; supports multiple trips per route
- Progress calculated from `length_km` column in `railway_routes`
- Only fully completed routes (date exists AND partial=false) count toward completion stats
- **Country Filtering**: Progress stats (km/%) respect selected countries from user preferences; filters routes where both start AND end countries are in selected list
- Progress stats show completed/total km and percentage (excludes partial routes)
- Frontend displays three-way color coding:
  - Dark green (#006400 / DarkGreen) for fully completed routes
  - Dark orange (#d97706) for partially completed routes
  - Crimson for unvisited routes
- Map interactions:
  - Hover over routes shows popup with details
  - Click routes to add them to the selected routes panel (no popups)

### Unified User Sidebar
- **Purpose**: Consolidated tabbed interface for route logging, journey planning, country filtering, and documentation
- **Location**: Resizable left-side sidebar (default 600px, range 400px-1200px)
- **Architecture**: Five tabs with activeTab state managed in MainLayout component
- **Resizing**: Blue drag handle between sidebar and map (same as admin interface)
- **Tab Switching**: Affects map interaction behavior (route clicking only works in Route Logger tab, station clicking only in Journey Planner tab)
- **State Management**: activeTab state in MainLayout flows down through VectorMapWrapper → VectorRailwayMap → UserSidebar (no useEffect synchronization)

#### Tab 1: Route Logger
- **Purpose**: Build a selection of routes for batch logging or individual management
- **Map Interaction**: Click routes on map to add them to the selection (only active in this tab)
- **UI Features**:
  - Each route shows: track number, stations, description, length, partial checkbox, edit icon, remove button
  - Compact single-line layout with text truncation for long names
  - Edit icon (pencil) opens "Manage trips" modal for individual route
  - Remove button (×) removes route from selection
  - "Clear all" button to empty the entire selection
- **Route Highlighting**:
  - Selected routes highlighted with thick colored overlay (width: 7, opacity: 0.9)
  - Green highlight (#059669) for logged routes (has date)
  - Red highlight (#DC2626) for unlogged routes (no date)
  - Highlights update automatically as routes are logged/unlogged
- **Bulk Logging**:
  - Date field (defaults to today's date, required)
  - Note field (optional, shared across all routes)
  - Partial checkbox per route (individual control)
  - "Log All X Routes" button logs entire selection at once
  - Uses `updateMultipleRoutes` with individual partial flags
  - Automatically refreshes map data and clears selection after successful save
- **Manage Trips Modal**:
  - Opens via edit icon on individual routes
  - Shows table of all trips for the selected route
  - Add new trips inline (date, note, partial fields)
  - Edit existing trips by changing fields (auto-saves on blur)
  - Delete trips with single click (no confirmation)
  - Real-time map refresh after add/update/delete operations

#### Tab 2: Journey Planner
- **Purpose**: Find routes between stations using pathfinding and add them to Route Logger for batch logging
- **Map Interaction**: Click stations on map to fill form fields (only active in this tab)
- **Station Filling Logic**:
  - If any field is focused (activeSearch) → fill that field
  - Else if "from" is empty → fill from
  - Else if "to" is empty → fill to
  - Via stations also supported with focused field
- **UI Features**:
  - "Clear All" button to reset all form fields
  - From/To station selection with autocomplete search
  - Multiple optional "via" stations (add/remove dynamically with drag-and-drop reordering)
  - All inputs support arrow key navigation and keyboard shortcuts
  - Diacritic-insensitive search (e.g., "bialystok" finds "Białystok")
  - Search prioritizes name-start matches over contains matches
  - Auto-clear station selection when user edits input
  - Drag handle (☰) for reordering via stations
- **Pathfinding** (`src/lib/routePathFinder.ts`):
  - Sequential segment pathfinding (A→B, B→C, C→D for via stations)
  - In-memory BFS graph search for performance
  - Progressive buffer search: 50km → 100km → 200km → 500km → 1000km
  - Route connections based on station name matching (not distance)
  - Station-to-route tolerance: Progressive 100m → 500m → 1km → 2km → 5km
  - Continues from previous segment's end route for path continuity
  - Supports unlimited journey length through via stations
- **Route Highlighting**:
  - Found routes highlighted in gold (#FFD700) on map
  - Uses separate `highlighted_routes` layer with vector tile source
- **Results Display**:
  - Shows found routes in compact list format (one route per line)
  - Displays route sequence: "1. Station A ⟷ Station B"
  - Shows individual route distance and total journey distance
  - "Add Routes to Selection" button adds routes and switches to Route Logger tab
  - Automatically filters out duplicates (routes already in selection)
  - Resets form after adding routes
- **Error Handling**:
  - Validates all via stations are selected before pathfinding
  - Shows helpful errors if stations/routes not found
  - Suggests adding via stations for segments >1000km

#### Tab 3: Country Settings & Stats
- **Purpose**: Filter railway routes by country and view per-country statistics
- **UI Features**:
  - Country checkboxes with flag emojis (🇨🇿 🇸🇰 🇦🇹 🇵🇱 🇩🇪 🇱🇹 🇱🇻 🇪🇪)
  - 8 supported countries: Czechia (CZ), Slovakia (SK), Austria (AT), Poland (PL), Germany (DE), Lithuania (LT), Latvia (LV), Estonia (EE)
  - Flag emojis generated using Unicode regional indicators (no external library)
  - "Select All" button - selects all 8 countries
  - "Select None" button - deselects all (shows empty map with 0 km stats)
  - Status indicator showing count of selected countries
  - Warning when no countries selected
- **Per-Country Statistics**:
  - Individual stats next to each country (e.g., "🇨🇿 Czechia - 1,234.5 / 5,678.9 km")
  - Shows routes where **both** start_country AND end_country match that country
  - Total stats at bottom showing overall completion across all countries
  - Real-time updates when routes are logged
  - Uses `getProgressByCountry()` server action
- **Filtering Logic**:
  - Shows routes where **both** start_country AND end_country are in selected list
  - Examples:
    - CZ only: Shows CZ→CZ routes
    - CZ + AT: Shows CZ→CZ, AT→AT, CZ→AT, and AT→CZ routes
    - Empty selection: Shows no routes (0/0 km)
- **Data Persistence**:
  - Preferences stored in `user_preferences` table per user
  - Server-side rendering: Preferences loaded before map renders (no flash)
  - Auto-saves to database on every change
- **Integration**:
  - Filters map display via vector tile query parameters
  - Filters progress statistics in all tabs
  - Admin map ignores country filter (always shows all routes)
- **Country Detection**:
  - Uses `@rapideditor/country-coder` library for worldwide boundary detection
  - Automatically determines start_country and end_country when admin creates/edits routes
  - Uses ISO 3166-1 alpha-2 codes (2-letter country codes)
  - Detection based on first and last coordinate of route geometry

#### Tab 4: How To Use
- **Purpose**: User documentation and instructions article
- **Access**: Click "How To Use" button in navbar (blue button next to title)
- **UI Features**:
  - Full-screen article view with header and close button (×)
  - Tab headers hidden when in article mode
  - Close button returns to Route Logger tab
  - Empty content area for user to fill with instructions

#### Tab 5: Railway Notes
- **Purpose**: Railway information and notes article
- **Access**: Click "Railway Notes" button in navbar (green button next to title)
- **UI Features**:
  - Full-screen article view with header and close button (×)
  - Tab headers hidden when in article mode
  - Close button returns to Route Logger tab
  - Empty content area for user to fill with railway notes
