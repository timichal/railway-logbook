import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getUser } from '@/lib/auth-actions';

// Helper function to convert tile coordinates to bounding box
function tileToBBox(z: number, x: number, y: number) {
  const n = Math.pow(2, z);
  const lon_min = (x / n) * 360 - 180;
  const lon_max = ((x + 1) / n) * 360 - 180;
  const lat_min = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
  const lat_max = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
  
  return {
    west: lon_min,
    south: lat_min,
    east: lon_max,
    north: lat_max
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tile: string[] }> }
) {
  console.log("yeep")
  try {
    // Check admin authentication
    const user = await getUser();
    if (!user || user.id !== 1) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Parse tile coordinates from URL
    const { tile } = await params;
    const [z, x, y] = tile.map(Number);
    
    if (isNaN(z) || isNaN(x) || isNaN(y)) {
      return NextResponse.json({ error: 'Invalid tile coordinates' }, { status: 400 });
    }

    // Convert tile coordinates to bounding box
    const bbox = tileToBBox(z, x, y);
    
    // Determine appropriate limit based on zoom level
    // For tiles, we can use more aggressive limits since each tile covers a smaller area
    const limit = z < 8 ? 500 : z < 10 ? 1500 : z < 12 ? 5000 : 10000;
    
    // Query railway parts within the tile bounds
    // Don't clip geometry to avoid holes - return full geometries that intersect the tile
    const partsResult = await query(`
      SELECT 
        id,
        ST_AsGeoJSON(geometry) as geometry
      FROM railway_parts
      WHERE ST_Intersects(
        geometry, 
        ST_MakeEnvelope($1, $2, $3, $4, 4326)
      )
      ORDER BY ST_Length(geometry) DESC
      LIMIT $5
    `, [bbox.west, bbox.south, bbox.east, bbox.north, limit]);

    // Build GeoJSON response
    const features = partsResult.rows
      .filter(row => row.geometry) // Filter out any null geometries
      .map(row => ({
        type: 'Feature' as const,
        geometry: JSON.parse(row.geometry),
        properties: {
          '@id': row.id,
          zoom_level: z,
          tile: `${z}/${x}/${y}`
        }
      }));

    const geoJson = {
      type: 'FeatureCollection' as const,
      features
    };

    // Set caching headers for better performance
    const response = NextResponse.json(geoJson);
    response.headers.set('Cache-Control', 'public, max-age=300'); // 5 minutes cache
    response.headers.set('Access-Control-Allow-Origin', '*');
    
    return response;

  } catch (error) {
    console.error('Error fetching tile data:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
