'use server';

import pool from './db';
import { getUser } from './auth-actions';
import { RailwayPathFinder } from '../scripts/lib/railwayPathFinder';
import type { PathResult } from './types';

export async function findRailwayPathDB(startId: string, endId: string): Promise<PathResult | null> {
  // Admin check
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  console.log('Database path finder: Finding path from', startId, 'to', endId);

  const pathFinder = new RailwayPathFinder();
  const result = await pathFinder.findPathWithRetry(pool, startId, endId);

  if (result) {
    console.log('Database path finder: Path found with', result.partIds.length, 'segments and', result.coordinates.length, 'coordinates');
  } else {
    console.log('Database path finder: No path found');
  }

  return result;
}