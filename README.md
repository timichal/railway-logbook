# Railway Logbook

A web application for tracking railway journeys using OpenStreetMap data. Still very much in development. (Also an experiment in vibe coding, almost everything was coded by Claude Code.)

Currently live at https://railmap.zlatkovsky.cz/

## Tech Stack

- **Frontend**: Next.js 15 + React 19 + MapLibre GL JS
- **Backend**: PostgreSQL 18 + PostGIS + Martin tile server
- **Data**: OpenStreetMap (stable dumps from 2025-01-01)

## Prerequisites

- **Node.js** (for Next.js application)
- **Docker** (for PostgreSQL database)
- **Osmium Tool** (for data processing): `conda install conda-forge::osmium-tool`

## Quick Start

1. **Start database and tile server**
```bash
docker compose up -d db tiles
```

2. **Process data**
```bash
npm run prepareData  # Downloads and transforms OSM data
npm run populateDb   # Loads data (no routes!) into database
npm run updateDb     # (Optional) Update railway parts and recalculate routes
```

3. **Run application**
```bash
npm run dev
```

Application runs at `http://localhost:3000`

## Architecture

### Data Flow
```
OSM PBF → Filter → GeoJSON → Prune → PostgreSQL → MapLibre
```

### Data Processing Scripts
- `osmium-scripts/prepare.sh` - Complete pipeline: downloads OSM data, filters rail features, converts to GeoJSON
- `src/scripts/pruneData.ts` - Removes subways and unwanted features
- `src/scripts/populateDb.ts` - Loads stations and railway_parts into database
- `src/scripts/updateDb.ts` - Reloads railway data and recalculates all routes

### Database Tables
- `users` - User accounts with authentication
- `stations` - Railway stations (Point features)
- `railway_parts` - Raw railway segments from OSM
- `railway_routes` - Defined routes with usage type (Regular/Seasonal/Special)
- `user_railway_data` - User ride history (dates, notes, partial flag)

### Features

**For Users:**
- Interactive map with hover popups showing route details
- Three-way color coding:
  - Dark green = fully completed routes
  - Dark orange = partially completed routes
  - Red = unvisited routes
- Progress tracking (km/% of total distance, excludes partial routes)
- Click routes to mark ride date, add notes, and flag partial completion

**For Admin (user_id=1):**
- Create routes by clicking railway_parts on map
- Automatic pathfinding between points (50km buffer, BFS algorithm)
- Assign usage type (Regular/Seasonal/Special)
- Edit route geometry to fix invalid routes after OSM updates
- Delete routes with security checks
- Auto-generated track_id and automatic length calculation
- Route validity tracking (is_valid flag, grey color for invalid routes)

## Data Sources

- OpenStreetMap: https://download.geofabrik.de/europe.html
- Using stable dump from 2025-01-01
- Filter: [OpenRailwayMap standard](https://github.com/OpenRailwayMap/OpenRailwayMap-CartoCSS/blob/master/SETUP.md)

## Development

See `CLAUDE.md` for detailed documentation.
