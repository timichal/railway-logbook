'use server'

import { getUser } from './authActions'
import pool from './db'
import type { Journey, LoggedPart, RailwayRoute } from './types'

/**
 * Get all journeys for a user with route counts and total distance
 */
export async function getAllJourneys(): Promise<{
  journeys: (Journey & { route_count: number; total_distance: string })[];
  error?: string
}> {
  try {
    const user = await getUser()
    if (!user) {
      return { journeys: [], error: 'Not authenticated' }
    }

    const result = await pool.query<Journey & { route_count: number; total_distance: string }>(
      `SELECT
        uj.*,
        COUNT(ulp.id)::int as route_count,
        COALESCE(SUM(rr.length_km), 0) as total_distance
      FROM user_journeys uj
      LEFT JOIN user_logged_parts ulp ON uj.id = ulp.journey_id
      LEFT JOIN railway_routes rr ON ulp.track_id = rr.track_id
      WHERE uj.user_id = $1
      GROUP BY uj.id
      ORDER BY uj.date DESC NULLS LAST, uj.created_at DESC`,
      [user.id]
    )

    return { journeys: result.rows }
  } catch (error) {
    console.error('Error fetching journeys:', error)
    return { journeys: [], error: 'Failed to fetch journeys' }
  }
}

/**
 * Get a single journey with all its logged routes
 */
export async function getJourney(journeyId: number): Promise<{
  journey: Journey | null;
  routes: RailwayRoute[];
  error?: string
}> {
  try {
    const user = await getUser()
    if (!user) {
      return { journey: null, routes: [], error: 'Not authenticated' }
    }

    // Fetch journey metadata
    const journeyResult = await pool.query<Journey>(
      'SELECT * FROM user_journeys WHERE id = $1 AND user_id = $2',
      [journeyId, user.id]
    )

    if (journeyResult.rows.length === 0) {
      return { journey: null, routes: [], error: 'Journey not found' }
    }

    // Fetch all routes in this journey
    const routesResult = await pool.query<RailwayRoute & LoggedPart>(
      `SELECT
        rr.*,
        ulp.partial,
        ST_AsGeoJSON(rr.geometry)::text as geometry
      FROM user_logged_parts ulp
      LEFT JOIN railway_routes rr ON ulp.track_id = rr.track_id
      WHERE ulp.journey_id = $1 AND ulp.user_id = $2
      ORDER BY ulp.created_at ASC`,
      [journeyId, user.id]
    )

    return {
      journey: journeyResult.rows[0],
      routes: routesResult.rows
    }
  } catch (error) {
    console.error('Error fetching journey:', error)
    return { journey: null, routes: [], error: 'Failed to fetch journey' }
  }
}

/**
 * Create a new journey and log routes to it (atomic operation)
 */
export async function createJourney(
  name: string,
  description: string | null,
  date: string, // YYYY-MM-DD
  trackIds: number[],
  partialFlags: boolean[]
): Promise<{ journey: Journey | null; error?: string }> {
  const client = await pool.connect()

  try {
    const user = await getUser()
    if (!user) {
      return { journey: null, error: 'Not authenticated' }
    }

    // Validate inputs
    if (!name || name.trim() === '') {
      return { journey: null, error: 'Journey name is required' }
    }

    if (!date) {
      return { journey: null, error: 'Journey date is required' }
    }

    if (trackIds.length !== partialFlags.length) {
      return { journey: null, error: 'Track IDs and partial flags length mismatch' }
    }

    await client.query('BEGIN')

    // Create journey
    const journeyResult = await client.query<Journey>(
      `INSERT INTO user_journeys (user_id, name, description, date)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [user.id, name.trim(), description, date]
    )

    const journey = journeyResult.rows[0]

    // Log routes to journey (batch insert)
    if (trackIds.length > 0) {
      // Build VALUES clause for batch insert
      const values: any[] = []
      const valuePlaceholders: string[] = []

      trackIds.forEach((trackId, index) => {
        const offset = index * 4
        valuePlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`)
        values.push(user.id, journey.id, trackId, partialFlags[index])
      })

      await client.query(
        `INSERT INTO user_logged_parts (user_id, journey_id, track_id, partial)
         VALUES ${valuePlaceholders.join(', ')}
         ON CONFLICT (journey_id, track_id) DO NOTHING`,
        values
      )
    }

    await client.query('COMMIT')

    return { journey }
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Error creating journey:', error)
    return { journey: null, error: 'Failed to create journey' }
  } finally {
    client.release()
  }
}

/**
 * Update journey metadata (name, description, date)
 */
export async function updateJourney(
  journeyId: number,
  name: string,
  description: string | null,
  date: string
): Promise<{ journey: Journey | null; error?: string }> {
  try {
    const user = await getUser()
    if (!user) {
      return { journey: null, error: 'Not authenticated' }
    }

    // Validate inputs
    if (!name || name.trim() === '') {
      return { journey: null, error: 'Journey name is required' }
    }

    if (!date) {
      return { journey: null, error: 'Journey date is required' }
    }

    const result = await pool.query<Journey>(
      `UPDATE user_journeys
       SET name = $1, description = $2, date = $3
       WHERE id = $4 AND user_id = $5
       RETURNING *`,
      [name.trim(), description, date, journeyId, user.id]
    )

    if (result.rows.length === 0) {
      return { journey: null, error: 'Journey not found' }
    }

    return { journey: result.rows[0] }
  } catch (error) {
    console.error('Error updating journey:', error)
    return { journey: null, error: 'Failed to update journey' }
  }
}

/**
 * Delete a journey and all its logged parts
 */
export async function deleteJourney(journeyId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getUser()
    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    const result = await pool.query(
      'DELETE FROM user_journeys WHERE id = $1 AND user_id = $2',
      [journeyId, user.id]
    )

    if (result.rowCount === 0) {
      return { success: false, error: 'Journey not found' }
    }

    return { success: true }
  } catch (error) {
    console.error('Error deleting journey:', error)
    return { success: false, error: 'Failed to delete journey' }
  }
}

/**
 * Add routes to an existing journey
 */
export async function addRoutesToJourney(
  journeyId: number,
  trackIds: number[],
  partialFlags: boolean[]
): Promise<{ success: boolean; error?: string }> {
  const client = await pool.connect()

  try {
    const user = await getUser()
    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    if (trackIds.length !== partialFlags.length) {
      return { success: false, error: 'Track IDs and partial flags length mismatch' }
    }

    // Verify journey belongs to user
    const journeyCheck = await client.query(
      'SELECT id FROM user_journeys WHERE id = $1 AND user_id = $2',
      [journeyId, user.id]
    )

    if (journeyCheck.rows.length === 0) {
      return { success: false, error: 'Journey not found' }
    }

    await client.query('BEGIN')

    // Batch insert routes
    if (trackIds.length > 0) {
      const values: any[] = []
      const valuePlaceholders: string[] = []

      trackIds.forEach((trackId, index) => {
        const offset = index * 4
        valuePlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`)
        values.push(user.id, journeyId, trackId, partialFlags[index])
      })

      await client.query(
        `INSERT INTO user_logged_parts (user_id, journey_id, track_id, partial)
         VALUES ${valuePlaceholders.join(', ')}
         ON CONFLICT (journey_id, track_id) DO UPDATE SET partial = EXCLUDED.partial`,
        values
      )
    }

    await client.query('COMMIT')

    return { success: true }
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Error adding routes to journey:', error)
    return { success: false, error: 'Failed to add routes to journey' }
  } finally {
    client.release()
  }
}

/**
 * Remove a single route from a journey
 */
export async function removeRouteFromJourney(
  journeyId: number,
  trackId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getUser()
    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    const result = await pool.query(
      'DELETE FROM user_logged_parts WHERE journey_id = $1 AND track_id = $2 AND user_id = $3',
      [journeyId, trackId, user.id]
    )

    if (result.rowCount === 0) {
      return { success: false, error: 'Route not found in journey' }
    }

    return { success: true }
  } catch (error) {
    console.error('Error removing route from journey:', error)
    return { success: false, error: 'Failed to remove route from journey' }
  }
}

/**
 * Toggle partial flag for a logged part
 */
export async function updateLoggedPartPartial(
  journeyId: number,
  trackId: number,
  partial: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getUser()
    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    const result = await pool.query(
      'UPDATE user_logged_parts SET partial = $1 WHERE journey_id = $2 AND track_id = $3 AND user_id = $4',
      [partial, journeyId, trackId, user.id]
    )

    if (result.rowCount === 0) {
      return { success: false, error: 'Route not found in journey' }
    }

    return { success: true }
  } catch (error) {
    console.error('Error updating logged part partial:', error)
    return { success: false, error: 'Failed to update partial flag' }
  }
}
