'use server';

import pool from './db';
import { getUser } from './auth-actions';

export async function deleteRailwayRoute(trackId: string): Promise<void> {
  // Admin check
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const client = await pool.connect();

  try {
    console.log('Deleting railway route with track_id:', trackId);

    // Delete from railway_routes table (CASCADE will handle user_railway_data)
    const deleteQuery = 'DELETE FROM railway_routes WHERE track_id = $1';
    const result = await client.query(deleteQuery, [trackId]);
    
    if (result.rowCount === 0) {
      throw new Error(`Route with track_id ${trackId} not found`);
    }
    
    console.log('Successfully deleted railway route:', trackId);
    
  } catch (error) {
    console.error('Error deleting railway route:', error);
    throw new Error(`Failed to delete route: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    client.release();
  }
}