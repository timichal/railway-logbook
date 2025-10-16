# OSM Railway Tracker

A web application for tracking railway journeys using OpenStreetMap data. Still very much in development. (Also an experiment in vibe coding, almost everything was coded by Claude Code.)

Currently live at https://railmap.zlatkovsky.cz/

## Tech Stack

- **Frontend**: Next.js 15 + React 19 + MapLibre GL JS
- **Backend**: PostgreSQL 16 + PostGIS + Martin tile server
- **Data**: OpenStreetMap (stable dumps from 2025-01-01)

## Prerequisites

- **Node.js** (for Next.js application)
- **Docker** (for PostgreSQL database)
- **Osmium Tool** (for data processing): `conda install conda-forge::osmium-tool`

## Quick Start

1. **Start database and tile server**
```bash
docker compose up -d postgres martin
```

2. **Process data**
```bash
npm run prepareData  # Downloads and transforms OSM data
npm run populateDb   # Loads data (no routes!) into database 
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
- `osmium-scripts/filterRailFeatures.sh` - Applies OpenRailwayMap filter
- `osmium-scripts/convertToGeojson.sh` - Converts to GeoJSON
- `src/scripts/pruneData.ts` - Removes subways and unwanted features
- `src/scripts/populateDb.ts` - Loads data into database

### Database Tables
- `users` - User accounts with authentication
- `stations` - Railway stations (Point features)
- `railway_parts` - Raw railway segments from OSM
- `railway_routes` - Defined routes (created by admin via UI)
- `user_railway_data` - User ride history (dates, notes)

### Features

**For Users:**
- Map of all routes (green = visited, red = unvisited)
- Progress tracking (km/% of total distance)
- Click routes to mark ride date and add notes

**For Admin (user_id=1):**
- Create routes by clicking railway_parts on map
- Automatic pathfinding between points (PostGIS, 50km buffer)
- Edit and delete routes
- Auto-generated track_id and automatic length calculation

## Data Sources

- OpenStreetMap: https://download.geofabrik.de/europe.html
- Using stable dump from 2025-01-01
- Filter: [OpenRailwayMap standard](https://github.com/OpenRailwayMap/OpenRailwayMap-CartoCSS/blob/master/SETUP.md)

## Development

See `CLAUDE.md` for detailed documentation.
