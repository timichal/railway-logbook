# Zoom Level Configuration

This document clearly defines zoom level rules across all layers of the application.

## Overview

Zoom levels control what data is visible at different map scales. Our system has **four layers** of zoom configuration that must be kept in sync.

## Zoom Range: 4-18

The application uses zoom levels **4 (far out) to 18 (close in)**.

## Configuration Layers

### 1. MapLibre Map Instance
**File**: `src/lib/map/hooks/useMapLibre.ts`
**Purpose**: Physical constraint - prevents users from zooming beyond limits

```typescript
minZoom: 4
maxZoom: 18
```

This is the **primary** zoom control. Users cannot zoom beyond these bounds.

### 2. Martin Tile Server
**File**: `martin/configuration.yml`
**Purpose**: Controls which zoom levels Martin will generate tiles for

```yaml
railway_routes_tile:
  minzoom: 4
  maxzoom: 18

railway_parts_tile:
  minzoom: 4
  maxzoom: 18

stations_tile:
  minzoom: 10  # Stations only visible from zoom 10+
  maxzoom: 18
```

Martin will **refuse** to generate tiles outside these ranges.

### 3. MapLibre Layer Configuration
**File**: `src/lib/map/index.ts`
**Purpose**: Tells MapLibre which zoom levels to request tiles for

```typescript
export const ZOOM_RANGES = {
  railwayRoutes: { min: 4, max: 18 },
  railwayParts: { min: 4, max: 18 },
  stations: { min: 10, max: 18 },
} as const;
```

Should **match** Martin's configuration to avoid unnecessary tile requests.

### 4. PostgreSQL Tile Functions
**File**: `database/init/02-vector-tiles.sql`
**Purpose**: Optional SQL-level filtering within tiles

```sql
-- railway_routes_tile: NO zoom filter (show all data at all zooms)
-- railway_parts_tile: Dynamic filtering based on segment length
-- stations_tile: Filter z >= 10
```

SQL filters can add **additional** restrictions beyond Martin's zoom ranges.

## Data Visibility Rules

### Railway Routes
- **Visible**: Zoom 4-18 (entire map range)
- **No SQL filters**: All routes shown at all zoom levels
- **Purpose**: Users always see railway routes when map is visible

### Railway Parts
- **Visible**: Zoom 4-18 (entire map range)
- **SQL filters**: Yes - longer segments shown at lower zooms for performance
  - Zoom < 8: Segments > 1000m
  - Zoom 8-10: Segments > 500m
  - Zoom 10+: All segments
- **Purpose**: Admin tool for creating routes

### Stations
- **Visible**: Zoom 10-18
- **SQL filter**: `z >= 10`
- **Purpose**: Avoid clutter at low zoom levels

### OSM Background
- **Visible**: Zoom 4-18
- **Purpose**: Base map layer

## When to Update

When changing zoom ranges, update **ALL FOUR** layers:

1. ✅ `useMapLibre.ts` - Map instance minZoom/maxZoom
2. ✅ `martin/configuration.yml` - Martin tile source definitions
3. ✅ `src/lib/map/index.ts` - ZOOM_RANGES constant
4. ⚠️ `database/init/02-vector-tiles.sql` - SQL filters (optional, only if needed)

## Testing Checklist

After changing zoom configuration:

- [ ] Restart Martin tile server (docker-compose restart martin)
- [ ] Clear browser cache
- [ ] Test zooming to minimum level (4) - routes should be visible
- [ ] Test zooming to maximum level (18) - routes should be visible
- [ ] Test stations appear at zoom 10+
- [ ] Check console for tile request errors

## Common Issues

**Issue**: Routes disappear at certain zoom levels
**Solution**: Check all four configuration layers are aligned

**Issue**: Martin returns 404 for tiles
**Solution**: Martin's zoom range doesn't match requested zoom level

**Issue**: Tiles requested but not displayed
**Solution**: MapLibre layer zoom range doesn't match Martin's range
