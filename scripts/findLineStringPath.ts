#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';

interface Feature {
  type: 'Feature';
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  properties: {
    '@id': number;
    [key: string]: any;
  };
}

interface GeoJSONData {
  type: 'FeatureCollection';
  features: Feature[];
}

type Coordinate = [number, number];
type CoordinateKey = string;

interface LineStringInfo {
  id: number;
  startCoord: Coordinate;
  endCoord: Coordinate;
}

class LineStringPathFinder {
  private lineStrings: Map<number, LineStringInfo> = new Map();
  private coordToLineStrings: Map<CoordinateKey, number[]> = new Map();

  constructor(private geoJsonPath: string, private silent: boolean = false) {
    this.loadData();
  }

  private coordinateToKey(coord: Coordinate): CoordinateKey {
    // Round to 7 decimal places to handle floating point precision issues
    return `${coord[0].toFixed(7)},${coord[1].toFixed(7)}`;
  }

  private loadData(): void {
    if (!this.silent) {
      console.log('Loading GeoJSON data...');
    }
    const data = JSON.parse(fs.readFileSync(this.geoJsonPath, 'utf-8')) as GeoJSONData;
    
    const lineStringFeatures = data.features.filter(f => f.geometry.type === 'LineString');
    if (!this.silent) {
      console.log(`Found ${lineStringFeatures.length} LineString features`);
    }

    // Build mapping
    for (const feature of lineStringFeatures) {
      const id = feature.properties['@id'];
      const coords = feature.geometry.coordinates;
      
      if (coords.length < 2) {
        console.warn(`LineString ${id} has less than 2 coordinates, skipping`);
        continue;
      }

      const startCoord = coords[0];
      const endCoord = coords[coords.length - 1];
      
      this.lineStrings.set(id, {
        id,
        startCoord,
        endCoord
      });

      // Add to coordinate mapping
      const startKey = this.coordinateToKey(startCoord);
      const endKey = this.coordinateToKey(endCoord);
      
      if (!this.coordToLineStrings.has(startKey)) {
        this.coordToLineStrings.set(startKey, []);
      }
      if (!this.coordToLineStrings.has(endKey)) {
        this.coordToLineStrings.set(endKey, []);
      }
      
      this.coordToLineStrings.get(startKey)!.push(id);
      if (startKey !== endKey) { // Avoid duplicates for closed loops
        this.coordToLineStrings.get(endKey)!.push(id);
      }
    }

    if (!this.silent) {
      console.log(`Built coordinate mapping for ${this.coordToLineStrings.size} unique coordinates`);
    }
  }

  private getConnectedLineStrings(lineStringId: number): number[] {
    const lineString = this.lineStrings.get(lineStringId);
    if (!lineString) {
      return [];
    }

    const connected = new Set<number>();
    
    // Check connections at start coordinate
    const startKey = this.coordinateToKey(lineString.startCoord);
    const startConnected = this.coordToLineStrings.get(startKey) || [];
    startConnected.forEach(id => {
      if (id !== lineStringId) {
        connected.add(id);
      }
    });

    // Check connections at end coordinate
    const endKey = this.coordinateToKey(lineString.endCoord);
    const endConnected = this.coordToLineStrings.get(endKey) || [];
    endConnected.forEach(id => {
      if (id !== lineStringId) {
        connected.add(id);
      }
    });

    return Array.from(connected);
  }

  public findPath(startId: number, endId: number): number[] | null {
    if (!this.lineStrings.has(startId)) {
      throw new Error(`Start LineString ID ${startId} not found`);
    }
    if (!this.lineStrings.has(endId)) {
      throw new Error(`End LineString ID ${endId} not found`);
    }

    if (startId === endId) {
      return [startId];
    }

    if (!this.silent) {
      console.log(`Finding path from LineString ${startId} to ${endId}...`);
    }

    // BFS to find shortest path
    const queue: { id: number; path: number[] }[] = [{ id: startId, path: [startId] }];
    const visited = new Set<number>([startId]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      
      // Get all connected LineStrings
      const connected = this.getConnectedLineStrings(current.id);
      
      for (const connectedId of connected) {
        if (connectedId === endId) {
          // Found the target!
          return [...current.path, connectedId];
        }
        
        if (!visited.has(connectedId)) {
          visited.add(connectedId);
          queue.push({
            id: connectedId,
            path: [...current.path, connectedId]
          });
        }
      }
    }

    return null; // No path found
  }

  public findAllPaths(startId: number, endId: number, maxDepth: number = 50): number[][] {
    if (!this.lineStrings.has(startId)) {
      throw new Error(`Start LineString ID ${startId} not found`);
    }
    if (!this.lineStrings.has(endId)) {
      throw new Error(`End LineString ID ${endId} not found`);
    }

    if (startId === endId) {
      return [[startId]];
    }

    if (!this.silent) {
      console.log(`Finding all paths from LineString ${startId} to ${endId} (max depth: ${maxDepth})...`);
    }

    const allPaths: number[][] = [];
    
    const dfs = (currentId: number, targetId: number, path: number[], visited: Set<number>, depth: number) => {
      if (depth > maxDepth) return;
      
      const connected = this.getConnectedLineStrings(currentId);
      
      for (const connectedId of connected) {
        if (connectedId === targetId) {
          allPaths.push([...path, connectedId]);
        } else if (!visited.has(connectedId)) {
          const newVisited = new Set(visited);
          newVisited.add(connectedId);
          dfs(connectedId, targetId, [...path, connectedId], newVisited, depth + 1);
        }
      }
    };

    const initialVisited = new Set([startId]);
    dfs(startId, endId, [startId], initialVisited, 0);

    return allPaths;
  }

  public getLineStringInfo(id: number): LineStringInfo | null {
    return this.lineStrings.get(id) || null;
  }

  public getConnections(id: number): { connected: number[], startConnections: number[], endConnections: number[] } {
    const lineString = this.lineStrings.get(id);
    if (!lineString) {
      return { connected: [], startConnections: [], endConnections: [] };
    }

    const startKey = this.coordinateToKey(lineString.startCoord);
    const endKey = this.coordinateToKey(lineString.endCoord);
    
    const startConnections = (this.coordToLineStrings.get(startKey) || []).filter(i => i !== id);
    const endConnections = (this.coordToLineStrings.get(endKey) || []).filter(i => i !== id);
    
    const allConnected = [...new Set([...startConnections, ...endConnections])];

    return {
      connected: allConnected,
      startConnections,
      endConnections
    };
  }
}

// CLI Interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: tsx findLineStringPath.ts <startId> <endId> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --all-paths     Find all possible paths (not just the shortest)');
    console.log('  --max-depth N   Maximum search depth for all-paths mode (default: 50)');
    console.log('  --info          Show connection info for the given LineString IDs');
    console.log('  --list          Output path as semicolon-separated quoted string');
    console.log('');
    console.log('Examples:');
    console.log('  tsx findLineStringPath.ts 4019799 4019800');
    console.log('  tsx findLineStringPath.ts 4019799 4019800 --all-paths');
    console.log('  tsx findLineStringPath.ts 4019799 4019800 --info');
    console.log('  tsx findLineStringPath.ts 4019799 4019800 --list');
    process.exit(1);
  }

  const startId = parseInt(args[0]);
  const endId = parseInt(args[1]);
  
  if (isNaN(startId) || isNaN(endId)) {
    console.error('Error: Both start and end IDs must be valid integers');
    process.exit(1);
  }

  const geoJsonPath = path.join(__dirname, '..', 'data', 'cz-pruned.geojson');
  
  if (!fs.existsSync(geoJsonPath)) {
    console.error(`Error: GeoJSON file not found at ${geoJsonPath}`);
    process.exit(1);
  }

  try {
    const showInfo = args.includes('--info');
    const findAllPaths = args.includes('--all-paths');
    const listOutput = args.includes('--list');
    
    const pathFinder = new LineStringPathFinder(geoJsonPath, listOutput);
    
    let maxDepth = 50;
    const maxDepthIndex = args.indexOf('--max-depth');
    if (maxDepthIndex !== -1 && maxDepthIndex + 1 < args.length) {
      const depth = parseInt(args[maxDepthIndex + 1]);
      if (!isNaN(depth) && depth > 0) {
        maxDepth = depth;
      }
    }

    if (showInfo) {
      console.log(`\n=== Connection Info ===`);
      console.log(`Start LineString ${startId}:`);
      const startInfo = pathFinder.getLineStringInfo(startId);
      if (startInfo) {
        console.log(`  Start coordinate: [${startInfo.startCoord[0]}, ${startInfo.startCoord[1]}]`);
        console.log(`  End coordinate: [${startInfo.endCoord[0]}, ${startInfo.endCoord[1]}]`);
        const startConnections = pathFinder.getConnections(startId);
        console.log(`  Connected LineStrings: ${startConnections.connected.join(', ')}`);
        console.log(`  Start connections: ${startConnections.startConnections.join(', ')}`);
        console.log(`  End connections: ${startConnections.endConnections.join(', ')}`);
      } else {
        console.log('  Not found!');
      }
      
      console.log(`\nEnd LineString ${endId}:`);
      const endInfo = pathFinder.getLineStringInfo(endId);
      if (endInfo) {
        console.log(`  Start coordinate: [${endInfo.startCoord[0]}, ${endInfo.startCoord[1]}]`);
        console.log(`  End coordinate: [${endInfo.endCoord[0]}, ${endInfo.endCoord[1]}]`);
        const endConnections = pathFinder.getConnections(endId);
        console.log(`  Connected LineStrings: ${endConnections.connected.join(', ')}`);
        console.log(`  Start connections: ${endConnections.startConnections.join(', ')}`);
        console.log(`  End connections: ${endConnections.endConnections.join(', ')}`);
      } else {
        console.log('  Not found!');
      }
      console.log('');
    }

    if (findAllPaths) {
      const allPaths = pathFinder.findAllPaths(startId, endId, maxDepth);
      
      if (allPaths.length === 0) {
        if (listOutput) {
          console.log('""');
        } else {
          console.log(`No paths found between LineString ${startId} and ${endId}`);
        }
      } else {
        if (listOutput) {
          // Show shortest path as semicolon-separated quoted string
          const shortestPath = allPaths.reduce((shortest, current) => 
            current.length < shortest.length ? current : shortest
          );
          console.log(`"${shortestPath.join(';')}"`);
        } else {
          console.log(`Found ${allPaths.length} possible paths:`);
          allPaths.forEach((path, index) => {
            console.log(`Path ${index + 1}: ${path.join(' -> ')}`);
          });
          
          // Show shortest path
          const shortestPath = allPaths.reduce((shortest, current) => 
            current.length < shortest.length ? current : shortest
          );
          console.log(`\nShortest path (${shortestPath.length - 1} hops): ${shortestPath.join(' -> ')}`);
        }
      }
    } else {
      const path = pathFinder.findPath(startId, endId);
      
      if (path) {
        if (listOutput) {
          console.log(`"${path.join(';')}"`);
        } else {
          console.log(`Path found: ${path.join(' -> ')}`);
          console.log(`Total segments: ${path.length}`);
          console.log(`Hops: ${path.length - 1}`);
        }
      } else {
        if (listOutput) {
          console.log('""');
        } else {
          console.log(`No path found between LineString ${startId} and ${endId}`);
        }
      }
    }

  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export { LineStringPathFinder };