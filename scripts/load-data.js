#!/usr/bin/env node

const fs = require('fs');
const { Client } = require('pg');

// Database connection configuration
const dbConfig = {
  host: 'localhost',
  port: 5432,
  database: 'railways',
  user: 'railways_user',
  password: 'railways_pass'
};

async function loadGeoJSONData() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('Connected to database');

    // Read the GeoJSON file
    const geoJsonPath = './data/merged-only.geojson';
    console.log('Reading GeoJSON file...');
    const geoJsonData = JSON.parse(fs.readFileSync(geoJsonPath, 'utf8'));

    // Clear existing data
    console.log('Clearing existing data...');
    await client.query('DELETE FROM user_railway_data');
    await client.query('DELETE FROM railway_routes');
    await client.query('DELETE FROM stations');

    let stationsCount = 0;
    let routesCount = 0;
    let userDataCount = 0;

    console.log('Processing features...');
    
    for (const feature of geoJsonData.features) {
      const { geometry, properties } = feature;

      if (geometry.type === 'Point') {
        // Handle stations
        const [lon, lat] = geometry.coordinates;
        
        await client.query(`
          INSERT INTO stations (id, name, coordinates)
          VALUES ($1, $2, ST_MakePoint($3, $4))
          ON CONFLICT (id) DO NOTHING
        `, [
          properties['@id'],
          properties.name || 'Unknown Station',
          lon,
          lat
        ]);
        
        stationsCount++;

      } else if (geometry.type === 'LineString') {
        // Handle railway routes
        if (!properties.track_id) {
          console.warn('Skipping LineString feature without track_id:', properties.name);
          continue;
        }

        // Convert coordinates to PostGIS LineString format
        const coordsStr = geometry.coordinates
          .map(coord => `${coord[0]} ${coord[1]}`)
          .join(',');
        const lineString = `LINESTRING(${coordsStr})`;

        // Extract usage types from description
        const usageTypes = [];
        if (properties.description) {
          if (properties.description.includes('Pravidelný provoz')) usageTypes.push('Regular');
          if (properties.description.includes('Sezónní provoz')) usageTypes.push('Seasonal');
          if (properties.description.includes('Provoz při zvláštních příležitostech')) usageTypes.push('Special');
          if (properties.description.includes('Provoz jednou denně')) usageTypes.push('OnceDaily');
          if (properties.description.includes('Provoz jednou týdně')) usageTypes.push('OnceWeekly');
          if (properties.description.includes('Provoz o pracovních dnech')) usageTypes.push('Weekdays');
          if (properties.description.includes('Provoz o víkendech')) usageTypes.push('Weekends');
        }

        // Extract operator from description
        let primaryOperator = 'Unknown';
        if (properties.description) {
          const operatorMatch = properties.description.match(/^[^,]+,\s*([^,\n]+)/);
          if (operatorMatch) {
            primaryOperator = operatorMatch[1].trim();
          }
        }

        // Insert railway route
        await client.query(`
          INSERT INTO railway_routes (
            track_id, name, usage_types, primary_operator,
            geometry, color, weight
          )
          VALUES ($1, $2, $3, $4, ST_GeomFromText($5, 4326), $6, $7)
          ON CONFLICT (track_id) DO UPDATE SET
            name = EXCLUDED.name,
            usage_types = EXCLUDED.usage_types,
            primary_operator = EXCLUDED.primary_operator,
            updated_at = CURRENT_TIMESTAMP
        `, [
          properties.track_id,
          properties.name || 'Unknown Route',
          usageTypes,
          primaryOperator,
          lineString,
          properties._umap_options?.color || '#0066ff',
          properties._umap_options?.weight || 3
        ]);

        routesCount++;

        // Extract and insert user data (last_ride, notes)
        if (properties.description) {
          let lastRide = null;
          let note = null;

          // Extract last ride date
          const lastRideMatch = properties.description.match(/Naposledy projeto: (\d{4}-\d{2}-\d{2})/);
          if (lastRideMatch) {
            lastRide = lastRideMatch[1];
          }

          // Extract notes (text in asterisks)
          const noteMatches = properties.description.match(/\*([^*]+)\*/g);
          if (noteMatches) {
            note = noteMatches.map(match => match.replace(/\*/g, '')).join(' | ');
          }

          // Insert user data if we have any
          if (lastRide || note) {
            await client.query(`
              INSERT INTO user_railway_data (user_id, track_id, last_ride, note)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (user_id, track_id) DO UPDATE SET
                last_ride = EXCLUDED.last_ride,
                note = EXCLUDED.note,
                updated_at = CURRENT_TIMESTAMP
            `, [1, properties.track_id, lastRide, note]);

            userDataCount++;
          }
        }
      }
    }

    console.log(`Data loading completed successfully!`);
    console.log(`- Stations loaded: ${stationsCount}`);
    console.log(`- Railway routes loaded: ${routesCount}`);
    console.log(`- User data entries loaded: ${userDataCount}`);

  } catch (error) {
    console.error('Error loading data:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the script
if (require.main === module) {
  loadGeoJSONData().catch(console.error);
}

module.exports = { loadGeoJSONData };