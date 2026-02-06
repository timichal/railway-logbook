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
- `npm run addTripsTable` - Migration: creates user_trips table and adds trip_id FK to user_journeys
- `npm run markAllRoutesInvalid` - Mark all routes as invalid for rechecking (sets is_valid=false and error_message='Route recheck')
  - Useful for forcing recalculation of all routes
  - Run `verifyRouteData` after to recalculate
- `npm run listStations` - List all unique station names from railway_routes table (sorted alphabetically)
  - Debugging utility for viewing station data
  - Combines from_station and to_station columns
- `npm run exportRouteData` - Export railway_routes, user_trips, user_journeys, user_logged_parts (user_id=1), and admin_notes to SQL dump using Docker (saved to `data/railway_data_YYYY-MM-DD.sql`)
  - Requires `db` container to be running
  - Uses `docker exec` to run `pg_dump` inside the container
- `npm run importRouteData <filename>` - Import railway data from SQL dump using Docker (e.g., `npm run importRouteData railway_data_2025-01-15.sql`)
  - Requires `db` container to be running
  - Uses `docker exec` to run `psql` inside the container

### Data Transfer Operations
- `npm run deployMapData` - Upload GeoJSON files from `./data/` to remote server via pscp
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
- **Database Credentials**: All scripts and database connections read credentials from `.env` file (DB_USER, POSTGRES_DB, etc.)

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
  - `railway_routes` - Railway lines with auto-generated track_id (SERIAL), from_station, to_station, track_number, description, usage_type (0=Regular, 1=Special), frequency (array of tags: Daily, Weekdays, Weekends, Once a week, Seasonal), link (external URL), scenic (BOOLEAN flag for particularly scenic routes), PostGIS geometry, length_km, start_country (ISO 3166-1 alpha-2), end_country (ISO 3166-1 alpha-2), **starting_coordinate (POINT)**, **ending_coordinate (POINT)**, is_valid flag, error_message, intended_backtracking flag, and has_backtracking flag
  - `railway_parts` - Raw railway segments from OSM data (used for admin route creation and pathfinding)
  - `user_trips` - Trip groupings for journeys (e.g., "Summer Holiday in Austria"); id, user_id, name (required, non-empty), description (optional), created_at, updated_at; authenticated users only
  - `user_journeys` - Named, dated collections of routes; id, user_id, name (required, non-empty), description (optional), date (required), trip_id (nullable FK to user_trips, ON DELETE SET NULL), created_at, updated_at; represents actual trips/journeys taken by users
  - `user_logged_parts` - Connects journeys to routes with partial flags; id, user_id, journey_id, track_id (nullable to preserve history), partial flag, created_at; UNIQUE constraint prevents duplicate routes within same journey
  - `user_preferences` - User preferences for country filtering; stores selected_countries as TEXT[] array of ISO country codes (defaults: CZ, SK, AT, PL, DE, LT, LV, EE)
  - `admin_notes` - Admin-only map notes with id, coordinate (PostGIS POINT), text, created_at, updated_at; auto-updates timestamp on edit
- **Spatial Indexing**: GIST indexes for efficient geographic queries
- **Auto-generated IDs**: track_id uses PostgreSQL SERIAL for automatic ID generation
- **Coordinate-Based Routing**: Routes store exact starting_coordinate and ending_coordinate (exact click points on railway parts) for precise recalculation; is_valid flag marks routes that can't be recalculated after OSM updates
- **Trip Grouping**: user_trips table groups journeys into named trips; journeys optionally reference a trip via trip_id FK (ON DELETE SET NULL); trip date range computed from min/max of assigned journey dates
- **Journey-Based Logging**: user_journeys table stores named trips with dates; user_logged_parts connects routes to journeys with partial flags; same route can appear in multiple journeys; UNIQUE constraint per journey prevents duplicates within a single journey
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
- **Unified User Sidebar** - Left-side resizable tabbed sidebar (400px-1200px) with tabs (Route Logger, My Journeys, My Trips [auth only], Country Settings & Stats) plus two article views (How To Use, Railway Notes); auth-aware rendering with JourneyLogger/LocalTripLogger
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
- **Components**: `AdminPageClient` → `VectorAdminMap` (dynamic import) + `AdminLayerControls`

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
- `admin/page.tsx` - Admin route management page (user_id=1 only)

#### Components (`src/components/`)

**User Map Components:**
- `MainLayout.tsx` - Client component wrapper managing activeTab state and resizable sidebar (400px-1200px); dynamically imports VectorRailwayMap
- `VectorRailwayMap.tsx` - Main user map with unified sidebar, station search, progress stats, and resizer handle
- `UserSidebar.tsx` - Unified tab-based sidebar (Route Logger / My Journeys / Country Settings & Stats) plus article views (How To Use / Railway Notes)
- `JourneyLogger.tsx` - Route Logger tab for authenticated users: route selection list with integrated journey planner, bulk logging form
- `LocalTripLogger.tsx` - Route Logger tab for unauthenticated users: localStorage-based route logging with trip limit
- `JourneyPlanner.tsx` - Journey Planner embedded in JourneyLogger: pathfinding between stations (from → via → to with drag-and-drop reordering); stations clickable on map
- `JourneyLogTab.tsx` - My Journeys tab for authenticated users: list of journeys with route details, editing, and trip assignment
- `LocalJourneyLogTab.tsx` - My Journeys tab for unauthenticated users: localStorage-based journey list
- `TripsTab.tsx` - My Trips tab for authenticated users: trip CRUD, journey assignment/unassignment, computed date ranges and stats
- `CountriesStatsTab.tsx` - Country Settings & Stats tab: country filter checkboxes (CZ, SK, AT, PL, DE, LT, LV, EE) with per-country stats and total
- `HowToUseArticle.tsx` - Article view with header and close button (content area for user instructions)
- `RailwayNotesArticle.tsx` - Article view with header and close button (content area for railway notes)

**Admin Map Components:**
- `AdminPageClient.tsx` - Admin page container with state management; dynamically imports VectorAdminMap
- `VectorAdminMap.tsx` - Admin map for route management with railway parts selection and notes system (right-click to create/edit notes)
- `AdminLayerControls.tsx` - Layer visibility checkboxes for admin map (Railway Parts, Railway Routes, Stations, Route Endpoints, Admin Notes)
- `AdminSidebar.tsx` - Tab-based sidebar (Create Route / Routes List)
- `AdminCreateRouteTab.tsx` - Route creation interface with start/end point selection
- `AdminRoutesTab.tsx` - Route list with search and edit functionality
- `RoutesList.tsx` - Paginated route table with validity indicators
- `RouteEditForm.tsx` - Form for editing route metadata (from/to/track/description/usage/scenic/frequency/link)
- `NotesPopup.tsx` - Popup component for creating/editing admin notes (text field, save/delete buttons, keyboard shortcuts)

**Shared Components:**
- `Navbar.tsx` - Navigation bar with title, login/logout dropdown, and article buttons ("How To Use" and "Railway Notes")
- `LoginForm.tsx` - Login form with email/password (rendered in navbar dropdown)
- `RegisterForm.tsx` - Registration form (rendered in navbar dropdown)

#### Library (`src/lib/`)

**Database & Actions:**
- `db.ts` - PostgreSQL connection pool (exports pool as default; uses .env for credentials)
- `dbConfig.ts` - Database configuration utilities (reads from .env file)
- `userActions.ts` - User-facing server actions (search stations, get GeoJSON data, get progress with country filtering)
- `userPreferencesActions.ts` - User preferences management (get/update selected countries, ensure defaults)
- `journeyActions.ts` - Journey CRUD server actions (create/update/delete journeys and logged parts, optional trip assignment on create)
- `tripActions.ts` - Trip CRUD server actions (create/update/delete trips, assign/unassign journeys, get unassigned journeys)
- `adminRouteActions.ts` - Admin-only route creation/update/deletion with security checks and automatic country detection
- `adminMapActions.ts` - Admin-only coordinate-based pathfinding (`findRailwayPathFromCoordinates`) and railway parts fetching by IDs
- `adminNotesActions.ts` - Admin-only notes CRUD operations (getAllAdminNotes, getAdminNote, createAdminNote, updateAdminNote, deleteAdminNote)
- `routePathFinder.ts` - Route-level pathfinding for journey planner (user-facing, uses station name matching)
- `authActions.ts` - Authentication actions (login, register, logout, getUser)
- `migrationActions.ts` - Data migration actions (migrate localStorage data to database on login)

**Data Access:**
- `dataAccess.ts` - Abstraction layer providing unified interface for database (authenticated) and localStorage (unauthenticated) data access
- `localStorage.ts` - LocalStorageManager class for unauthenticated user data persistence (journeys, logged parts, preferences)

**Utilities:**
- `types.ts` - Core TypeScript type definitions (Station, GeoJSONFeature, RailwayRoute, UserJourney, UserLoggedPart, UserPreferences, SelectedRoute, etc.)
- `constants.ts` - Usage type options (Regular=0, Special=1), frequency options (Daily, Weekdays, Weekends, Once a week, Seasonal), UsageType type export
- `coordinateUtils.ts` - Coordinate utilities (mergeLinearChain algorithm, coordinatesToWKT)
- `countryUtils.ts` - Country detection from coordinates using @rapideditor/country-coder (worldwide boundary detection, ISO 3166-1 alpha-2 codes)
- `getUntimezonedDateStr.ts` - Date utility for timezone-agnostic date string formatting

**Toast System (`src/lib/toast/`):**
- `index.ts` - Toast module exports (useToast hook, ToastContainer, ConfirmDialog)
- `ToastContext.tsx` - Toast context provider with showSuccess/showError/confirm functions
- `ToastContainer.tsx` - Toast notification display component
- `ConfirmDialog.tsx` - Confirmation dialog component for destructive actions
- `types.ts` - Toast type definitions

#### Map Library (`src/lib/map/`)

**Core:**
- `index.ts` - Map constants, COLORS, layer factories (createRailwayRoutesSource/Layer, createScenicRoutesOutlineLayer, createStationsSource/Layer, createRailwayPartsSource/Layer, createAdminNotesSource/Layer), closeAllPopups utility
- `mapState.ts` - Shared map state management (save/load map position)

**Hooks:**
- `hooks/useMapLibre.ts` - Base hook for MapLibre GL initialization with sources, layers, navigation controls, and geolocation control
- `hooks/useRouteEditor.ts` - Hook for progress tracking with country filtering, special lines toggle, map refresh
- `hooks/useStationSearch.ts` - Hook for station search with debouncing and keyboard navigation
- `hooks/useRouteLength.ts` - Hook for calculating route length display
- `hooks/useAdminLayerVisibility.ts` - Manages visibility toggles for all admin map layers and edit-geometry mode sync
- `hooks/useAdminMapOverlays.ts` - Manages GeoJSON overlay layers on admin map (preview route, selected points, route endpoints)
- `hooks/useAdminNotesPopup.tsx` - Right-click notes popup system (create/edit notes, cache busting)
- `hooks/useMapTileRefresh.ts` - Manages railway routes tile cache busting for user map
- `hooks/useRouteHighlighting.ts` - Manages highlight overlay layers (gold journey planner, green/red/orange selection)
- `hooks/useLayerFilters.ts` - Manages special lines filter and scenic outline visibility on user map

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
- `applyVectorTiles.ts` - Applies/updates vector tile functions from SQL file
- `addTripsTable.ts` - Migration: creates user_trips table and adds trip_id FK to user_journeys
- `markAllRoutesInvalid.ts` - Marks all routes as invalid for rechecking (utility script; **use as example for database migration scripts**)
- `listStations.ts` - Lists all unique station names from railway_routes (debugging utility)
- `exportRoutes.ts` - Export railway_routes, user_journeys, user_logged_parts (user_id=1), and admin_notes to SQL dump
- `importRoutes.ts` - Import railway data from SQL dump

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
- Contains tables for users, stations, railway_routes (with frequency, link, scenic flag, start_country, end_country, starting_coordinate, ending_coordinate, is_valid, error_message, backtracking flags), railway_parts, user_trips (trip groupings with name/description), user_journeys (named trips with dates, optional trip_id FK), user_logged_parts (journey-route connections with partial flags), user_preferences (selected_countries array), and admin_notes (coordinate, text, timestamps)

### Configuration Files
- `eslint.config.mjs` - ESLint configuration
- `postcss.config.mjs` - PostCSS configuration for Tailwind
- `public/` - Static assets served by Next.js

### Output Data (`data/`)
- `<country>.tmp.osm.pbf` - Downloaded OSM data
- `<country>-rail.tmp.osm.pbf` - Filtered railway data
- `<country>-rail.tmp.geojson` - Converted to GeoJSON
- `<country>-pruned.geojson` - Custom filtered data (ready for database loading)
- `railway_data_YYYY-MM-DD.sql` - Exported railway_routes, user_trips, user_journeys, user_logged_parts (user_id=1), and admin_notes (from `npm run exportRouteData`)

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
- **Journey-Based System**: User-specific data organized in journeys (named trips with dates) and logged parts (route connections)
- Data stored in `user_journeys` (id, user_id, name, description, date) and `user_logged_parts` (id, user_id, journey_id, track_id, partial)
- Progress calculated from `length_km` column in `railway_routes`
- Route completion logic:
  - Fully completed: Route logged in at least one journey with partial=false
  - Partially completed: Route logged only with partial=true in all journeys
  - Unvisited: Route never logged
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
- **Purpose**: Consolidated tabbed interface for route logging, journey management, country filtering, and documentation
- **Location**: Resizable left-side sidebar (default 600px, range 400px-1200px)
- **Architecture**: Visible tabs (Route Logger, My Journeys, My Trips [auth only], Country Settings & Stats) plus two article views (How To Use, Railway Notes) with activeTab state managed in MainLayout component
- **Auth-Aware**: Renders `JourneyLogger` for authenticated users, `LocalTripLogger` for unauthenticated users in Route Logger tab; similar split for My Journeys tab
- **Resizing**: Blue drag handle between sidebar and map (same as admin interface)
- **Tab Switching**: Affects map interaction behavior (route clicking and station clicking only work in Route Logger tab)
- **State Management**: activeTab state in MainLayout flows down through VectorRailwayMap → UserSidebar (no useEffect synchronization)

#### Tab 1: Route Logger
- **Purpose**: Build a selection of routes for batch logging to a new or existing journey
- **Components**: `JourneyLogger.tsx` (authenticated) / `LocalTripLogger.tsx` (unauthenticated)
- **Map Interaction**: Click routes on map to add them to the selection; click stations to fill journey planner fields (both only active in this tab)
- **UI Features**:
  - Each route shows: track number, stations, description, length, partial checkbox, remove button
  - Compact single-line layout with text truncation for long names
  - Remove button (×) removes route from selection
  - "Clear all" button to empty the entire selection
  - Integrated Journey Planner (collapsible section within the tab)
- **Route Highlighting**:
  - Selected routes highlighted with thick colored overlay (width: 7, opacity: 0.9)
  - Green highlight (#059669) for logged routes (fully completed)
  - Red highlight (#DC2626) for unlogged routes
  - Highlights update automatically as routes are logged/unlogged
- **Journey Logging**:
  - Journey name field (required, non-empty)
  - Journey description field (optional)
  - Date field (defaults to today's date, required)
  - Partial checkbox per route (individual control)
  - "Log Journey" button creates new journey with all selected routes
  - Automatically refreshes map data and clears selection after successful save
- **Embedded Journey Planner** (`JourneyPlanner.tsx`):
  - Find routes between stations using pathfinding and add them to route selection
  - Click stations on map to fill form fields
  - Station Filling Logic: if field focused → fill that field; else fill from → to in order
  - From/To station selection with autocomplete search
  - Multiple optional "via" stations (add/remove dynamically with drag-and-drop reordering)
  - Diacritic-insensitive search (e.g., "bialystok" finds "Białystok")
  - **Pathfinding** (`src/lib/routePathFinder.ts`): Sequential segment BFS, progressive buffer (50km→1000km), station name matching, excludes special routes
  - Found routes highlighted in gold (#FFD700) on map
  - "Add Routes to Selection" button adds routes to the selection list above

#### Tab 2: My Journeys
- **Purpose**: View and manage user's logged journeys
- **UI Features**:
  - List of all journeys sorted by date (newest first)
  - Each journey shows: name, description, date, route count, total distance
  - Expandable journey details showing all routes in the journey
  - Edit journey details (name, description, date)
  - Delete entire journeys
  - Remove individual routes from journeys
  - Toggle partial flag for routes within journeys
- **Real-time Updates**: Map refreshes automatically after any changes

#### Tab 3: My Trips (authenticated only)
- **Purpose**: Group journeys into named trips (e.g., "Summer Holiday in Austria")
- **Components**: `TripsTab.tsx`
- **UI Features**:
  - "New Trip" button to create trips (name required, description optional)
  - Trip cards showing: name, description, computed date range, journey count, route count, total km
  - Expand trip to: edit form (name, description), list of assigned journeys with "Remove" buttons, "Add Journeys" picker
  - Picker shows unassigned journeys with "Add" button for each
  - Search bar to filter trips by name/description
- **Data Model**: `user_trips` table; journeys link via `trip_id` FK (ON DELETE SET NULL)
- **Integration**: Trip badges shown as purple pills in My Journeys tab; trip dropdown in journey creation and edit forms

#### Tab 4: Country Settings & Stats
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

#### Article View: How To Use
- **Purpose**: User documentation and instructions article
- **Access**: Click "How To Use" button in navbar (blue button next to title)
- **UI Features**:
  - Full-screen article view with header and close button (×)
  - Tab headers hidden when in article mode
  - Close button returns to Route Logger tab
  - Empty content area for user to fill with instructions

#### Article View: Railway Notes
- **Purpose**: Railway information and notes article
- **Access**: Click "Railway Notes" button in navbar (green button next to title)
- **UI Features**:
  - Full-screen article view with header and close button (×)
  - Tab headers hidden when in article mode
  - Close button returns to Route Logger tab
  - Empty content area for user to fill with railway notes
