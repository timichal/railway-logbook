# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is an OSM (OpenStreetMap) railway data processing pipeline that fetches, filters, and processes railway data from Czech Republic and Austria. The project converts OpenStreetMap data into GeoJSON format and applies railway definitions to create combined datasets for visualization on UMap.

## Core Commands

### Data Processing Pipeline
- `npm run prepare` - Complete data preparation pipeline (downloads OSM data, filters rail features, merges countries, converts to GeoJSON, and prunes data)
- `npm run check <country_code>` - Validates railway definitions for a country (e.g., `npm run check cz`)
- `npm run apply <country_code>` - Applies railway definitions to create combined GeoJSON (e.g., `npm run apply cz`)
- `npm run merge` - Combines all `-combined.geojson` files into `merged-only.geojson`

### Prerequisites
- **Osmium Tool** required for data processing: `conda install conda-forge::osmium-tool`
- **TypeScript execution**: Uses `tsx` for running TypeScript files directly

## Data Flow Architecture

### 1. Data Sources
- OpenStreetMap data from https://download.geofabrik.de/europe.html
- Country-specific OSM PBF files (e.g., `cz.osm.pbf`, `at.osm.pbf`)

### 2. Processing Pipeline
1. **Download** (`osmium-scripts/download.sh`) - Downloads OSM PBF data for specified countries
2. **Filter** (`osmium-scripts/filterRailFeatures.sh`) - Applies OpenRailwayMap filter to extract railway features
3. **Merge** (`osmium-scripts/merge.sh`) - Combines data from multiple countries for cross-border routes
4. **Convert** (`osmium-scripts/convertToGeojson.sh`) - Converts filtered OSM data to GeoJSON format
5. **Prune** (`pruneData.ts`) - Applies custom filters to remove unwanted features
6. **Apply Definitions** (`applyRailwayDefinitions.ts`) - Merges railway segments according to definitions
7. **Final Merge** (`mergeCountryFiles.ts`) - Combines all country data into single output

### 3. Data Transformations
- **Input**: Raw OSM data with railway features
- **Intermediate**: Filtered GeoJSON with railway lines and stations
- **Output**: Combined GeoJSON with named railway routes and metadata

## Key File Structure

### Core Processing Scripts
- `checkRailwayDefinitions.ts` - Validates railway definitions against OSM data
- `applyRailwayDefinitions.ts` - Combines railway segments into complete routes
- `mergeCountryFiles.ts` - Merges multiple country datasets
- `pruneData.ts` - Filters unwanted railway features
- `mergeCoordinateLists.ts` - Utility for combining coordinate arrays

### Data Definitions
- `definitions/cz.ts` - Czech railway route definitions (~265KB file)
- `definitions/at.ts` - Austrian railway route definitions  
- `definitions/at-cz.ts` - Cross-border route definitions

### Type System
- `types.ts` - Core type definitions for GeoJSON features and railway data
- `enums.ts` - Usage patterns (Regular, OnceDaily, Seasonal, etc.) and operators (ČD, ÖBB, etc.)

### Output Data
- `data/<country>-pruned.geojson` - Filtered railway data per country
- `data/<country>-combined.geojson` - Complete routes with definitions applied
- `data/merged-only.geojson` - Final combined dataset for visualization

## Railway Definition Structure

Railway definitions in `definitions/` files follow this schema:
```typescript
{
  from: string,           // Starting station
  to: string,             // Ending station  
  local_number: string,   // Railway line number
  usage: Usage[],         // Service frequency pattern
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

### Output Format
Final GeoJSON includes custom properties for visualization:
- `track_id` - Unique identifier for railway routes
- Dynamic styling based on user data and usage types
- Localized descriptions in Czech/German based on operator