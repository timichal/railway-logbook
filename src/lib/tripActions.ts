"use server";

import { getUser } from "./authActions";
import pool from "./db";
import type { Journey, Trip } from "./types";

// Trip with computed stats from joined journey data
export type TripWithStats = Trip & {
  journey_count: number;
  route_count: number;
  total_distance: string;
  start_date: string | null;
  end_date: string | null;
};

// Journey with route stats (used in trip detail view)
export type JourneyInTrip = Journey & {
  route_count: number;
  total_distance: string;
};

/**
 * Get all trips for the current user with computed stats
 */
export async function getAllTrips(): Promise<{
  trips: TripWithStats[];
  error?: string;
}> {
  try {
    const user = await getUser();
    if (!user) {
      return { trips: [], error: "Not authenticated" };
    }

    const result = await pool.query<TripWithStats>(
      `SELECT
        ut.*,
        COUNT(DISTINCT uj.id)::int as journey_count,
        COUNT(DISTINCT ulp.id)::int as route_count,
        COALESCE(SUM(DISTINCT CASE WHEN rr.track_id IS NOT NULL THEN rr.length_km ELSE 0 END), 0) as total_distance,
        MIN(uj.date)::text as start_date,
        MAX(uj.date)::text as end_date
      FROM user_trips ut
      LEFT JOIN user_journeys uj ON ut.id = uj.trip_id AND uj.user_id = $1
      LEFT JOIN user_logged_parts ulp ON uj.id = ulp.journey_id
      LEFT JOIN railway_routes rr ON ulp.track_id = rr.track_id
      WHERE ut.user_id = $1
      GROUP BY ut.id
      ORDER BY MAX(uj.date) DESC NULLS LAST, ut.created_at DESC`,
      [user.id],
    );

    return { trips: result.rows };
  } catch (error) {
    console.error("Error fetching trips:", error);
    return { trips: [], error: "Failed to fetch trips" };
  }
}

/**
 * Get a single trip with its assigned journeys
 */
export async function getTrip(tripId: number): Promise<{
  trip: Trip | null;
  journeys: JourneyInTrip[];
  routeIds: number[];
  error?: string;
}> {
  try {
    const user = await getUser();
    if (!user) {
      return { trip: null, journeys: [], routeIds: [], error: "Not authenticated" };
    }

    const tripResult = await pool.query<Trip>(
      "SELECT * FROM user_trips WHERE id = $1 AND user_id = $2",
      [tripId, user.id],
    );

    if (tripResult.rows.length === 0) {
      return { trip: null, journeys: [], routeIds: [], error: "Trip not found" };
    }

    const journeysResult = await pool.query<JourneyInTrip>(
      `SELECT
        uj.*,
        COUNT(ulp.id)::int as route_count,
        COALESCE(SUM(rr.length_km), 0) as total_distance
      FROM user_journeys uj
      LEFT JOIN user_logged_parts ulp ON uj.id = ulp.journey_id
      LEFT JOIN railway_routes rr ON ulp.track_id = rr.track_id
      WHERE uj.trip_id = $1 AND uj.user_id = $2
      GROUP BY uj.id
      ORDER BY uj.date ASC`,
      [tripId, user.id],
    );

    // Fetch all distinct route IDs across all journeys in this trip
    const routeIdsResult = await pool.query<{ track_id: number }>(
      `SELECT DISTINCT ulp.track_id
      FROM user_logged_parts ulp
      JOIN user_journeys uj ON ulp.journey_id = uj.id
      WHERE uj.trip_id = $1 AND uj.user_id = $2 AND ulp.track_id IS NOT NULL`,
      [tripId, user.id],
    );

    return {
      trip: tripResult.rows[0],
      journeys: journeysResult.rows,
      routeIds: routeIdsResult.rows.map((r) => r.track_id),
    };
  } catch (error) {
    console.error("Error fetching trip:", error);
    return { trip: null, journeys: [], routeIds: [], error: "Failed to fetch trip" };
  }
}

/**
 * Create a new trip
 */
export async function createTrip(
  name: string,
  description: string | null,
): Promise<{ trip: Trip | null; error?: string }> {
  try {
    const user = await getUser();
    if (!user) {
      return { trip: null, error: "Not authenticated" };
    }

    if (!name || name.trim() === "") {
      return { trip: null, error: "Trip name is required" };
    }

    const result = await pool.query<Trip>(
      `INSERT INTO user_trips (user_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [user.id, name.trim(), description],
    );

    return { trip: result.rows[0] };
  } catch (error) {
    console.error("Error creating trip:", error);
    return { trip: null, error: "Failed to create trip" };
  }
}

/**
 * Update trip metadata (name, description)
 */
export async function updateTrip(
  tripId: number,
  name: string,
  description: string | null,
): Promise<{ trip: Trip | null; error?: string }> {
  try {
    const user = await getUser();
    if (!user) {
      return { trip: null, error: "Not authenticated" };
    }

    if (!name || name.trim() === "") {
      return { trip: null, error: "Trip name is required" };
    }

    const result = await pool.query<Trip>(
      `UPDATE user_trips
       SET name = $1, description = $2
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [name.trim(), description, tripId, user.id],
    );

    if (result.rows.length === 0) {
      return { trip: null, error: "Trip not found" };
    }

    return { trip: result.rows[0] };
  } catch (error) {
    console.error("Error updating trip:", error);
    return { trip: null, error: "Failed to update trip" };
  }
}

/**
 * Delete a trip (journeys get unassigned via ON DELETE SET NULL)
 */
export async function deleteTrip(tripId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getUser();
    if (!user) {
      return { success: false, error: "Not authenticated" };
    }

    const result = await pool.query("DELETE FROM user_trips WHERE id = $1 AND user_id = $2", [
      tripId,
      user.id,
    ]);

    if (result.rowCount === 0) {
      return { success: false, error: "Trip not found" };
    }

    return { success: true };
  } catch (error) {
    console.error("Error deleting trip:", error);
    return { success: false, error: "Failed to delete trip" };
  }
}

/**
 * Assign a journey to a trip
 */
export async function assignJourneyToTrip(
  journeyId: number,
  tripId: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getUser();
    if (!user) {
      return { success: false, error: "Not authenticated" };
    }

    // Verify trip belongs to user
    const tripCheck = await pool.query("SELECT id FROM user_trips WHERE id = $1 AND user_id = $2", [
      tripId,
      user.id,
    ]);
    if (tripCheck.rows.length === 0) {
      return { success: false, error: "Trip not found" };
    }

    const result = await pool.query(
      "UPDATE user_journeys SET trip_id = $1 WHERE id = $2 AND user_id = $3",
      [tripId, journeyId, user.id],
    );

    if (result.rowCount === 0) {
      return { success: false, error: "Journey not found" };
    }

    return { success: true };
  } catch (error) {
    console.error("Error assigning journey to trip:", error);
    return { success: false, error: "Failed to assign journey to trip" };
  }
}

/**
 * Unassign a journey from its trip (set trip_id = NULL)
 */
export async function unassignJourneyFromTrip(
  journeyId: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getUser();
    if (!user) {
      return { success: false, error: "Not authenticated" };
    }

    const result = await pool.query(
      "UPDATE user_journeys SET trip_id = NULL WHERE id = $1 AND user_id = $2",
      [journeyId, user.id],
    );

    if (result.rowCount === 0) {
      return { success: false, error: "Journey not found" };
    }

    return { success: true };
  } catch (error) {
    console.error("Error unassigning journey from trip:", error);
    return { success: false, error: "Failed to unassign journey from trip" };
  }
}

// Standalone journey (not assigned to a trip) with stats — for the merged list
export type StandaloneJourneyWithStats = Journey & {
  route_count: number;
  total_distance: string;
};

// One row in the merged trips+journeys list. A trip carries its assigned journeys; a standalone journey stands on its own.
export type TripsAndJourneysItem =
  | { type: "trip"; trip: TripWithStats; journeys: JourneyInTrip[] }
  | { type: "journey"; journey: StandaloneJourneyWithStats };

/**
 * Get a paginated, search-filtered list of top-level items (trips and standalone journeys),
 * sorted by date desc. Trip date = max date of its assigned journeys; standalone journey date = its own date.
 */
export async function getJourneysAndTrips(
  page: number,
  pageSize: number,
  search: string = "",
): Promise<{ items: TripsAndJourneysItem[]; total: number; error?: string }> {
  try {
    const user = await getUser();
    if (!user) {
      return { items: [], total: 0, error: "Not authenticated" };
    }

    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
    const offset = (safePage - 1) * safePageSize;
    const searchPattern = search.trim() ? `%${search.trim().toLowerCase()}%` : null;

    // Build the union of trips + standalone journeys with effective_date for sorting.
    // The search predicate (when present) is applied per branch to keep it index-friendly.
    const baseCte = `
      WITH ordered AS (
        SELECT 'trip'::text AS type, ut.id AS item_id,
               MAX(uj.date)::text AS effective_date,
               ut.created_at AS sort_created_at
        FROM user_trips ut
        LEFT JOIN user_journeys uj ON ut.id = uj.trip_id AND uj.user_id = $1
        WHERE ut.user_id = $1
          ${searchPattern ? `AND (LOWER(ut.name) LIKE $2 OR LOWER(COALESCE(ut.description, '')) LIKE $2)` : ""}
        GROUP BY ut.id

        UNION ALL

        SELECT 'journey'::text AS type, uj.id AS item_id,
               uj.date::text AS effective_date,
               uj.created_at AS sort_created_at
        FROM user_journeys uj
        WHERE uj.user_id = $1 AND uj.trip_id IS NULL
          ${searchPattern ? `AND (LOWER(uj.name) LIKE $2 OR LOWER(COALESCE(uj.description, '')) LIKE $2 OR uj.date::text LIKE $2)` : ""}
      )
    `;

    // Total count for pagination UI
    const countParams: any[] = [user.id];
    if (searchPattern) countParams.push(searchPattern);
    const countResult = await pool.query<{ total: string }>(
      `${baseCte} SELECT COUNT(*)::text AS total FROM ordered`,
      countParams,
    );
    const total = parseInt(countResult.rows[0]?.total ?? "0", 10);

    // Page of (type, id) ordered by effective_date desc, then created_at desc as tiebreaker
    const pageParams: any[] = [user.id];
    if (searchPattern) pageParams.push(searchPattern);
    const limitIdx = pageParams.length + 1;
    const offsetIdx = pageParams.length + 2;
    pageParams.push(safePageSize, offset);

    const pageResult = await pool.query<{ type: "trip" | "journey"; item_id: number }>(
      `${baseCte}
       SELECT type, item_id FROM ordered
       ORDER BY effective_date DESC NULLS FIRST, sort_created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      pageParams,
    );

    const tripIds = pageResult.rows.filter((r) => r.type === "trip").map((r) => r.item_id);
    const journeyIds = pageResult.rows.filter((r) => r.type === "journey").map((r) => r.item_id);

    // Hydrate trips on the page (with stats)
    const tripsById = new Map<number, TripWithStats>();
    if (tripIds.length > 0) {
      const tripsResult = await pool.query<TripWithStats>(
        `SELECT
          ut.*,
          COUNT(DISTINCT uj.id)::int as journey_count,
          COUNT(DISTINCT ulp.id)::int as route_count,
          COALESCE(SUM(DISTINCT CASE WHEN rr.track_id IS NOT NULL THEN rr.length_km ELSE 0 END), 0) as total_distance,
          MIN(uj.date)::text as start_date,
          MAX(uj.date)::text as end_date
        FROM user_trips ut
        LEFT JOIN user_journeys uj ON ut.id = uj.trip_id AND uj.user_id = $1
        LEFT JOIN user_logged_parts ulp ON uj.id = ulp.journey_id
        LEFT JOIN railway_routes rr ON ulp.track_id = rr.track_id
        WHERE ut.user_id = $1 AND ut.id = ANY($2::int[])
        GROUP BY ut.id`,
        [user.id, tripIds],
      );
      tripsResult.rows.forEach((t) => {
        tripsById.set(t.id, t);
      });
    }

    // Hydrate journeys assigned to those trips (one query for all)
    const tripJourneysByTripId = new Map<number, JourneyInTrip[]>();
    if (tripIds.length > 0) {
      const tripJourneysResult = await pool.query<JourneyInTrip>(
        `SELECT
          uj.*,
          COUNT(ulp.id)::int as route_count,
          COALESCE(SUM(rr.length_km), 0) as total_distance
        FROM user_journeys uj
        LEFT JOIN user_logged_parts ulp ON uj.id = ulp.journey_id
        LEFT JOIN railway_routes rr ON ulp.track_id = rr.track_id
        WHERE uj.user_id = $1 AND uj.trip_id = ANY($2::int[])
        GROUP BY uj.id
        ORDER BY uj.date ASC`,
        [user.id, tripIds],
      );
      tripJourneysResult.rows.forEach((j) => {
        const arr = tripJourneysByTripId.get(j.trip_id!) ?? [];
        arr.push(j);
        tripJourneysByTripId.set(j.trip_id!, arr);
      });
    }

    // Hydrate standalone journeys on the page
    const journeysById = new Map<number, StandaloneJourneyWithStats>();
    if (journeyIds.length > 0) {
      const journeysResult = await pool.query<StandaloneJourneyWithStats>(
        `SELECT
          uj.*,
          COUNT(ulp.id)::int as route_count,
          COALESCE(SUM(rr.length_km), 0) as total_distance
        FROM user_journeys uj
        LEFT JOIN user_logged_parts ulp ON uj.id = ulp.journey_id
        LEFT JOIN railway_routes rr ON ulp.track_id = rr.track_id
        WHERE uj.user_id = $1 AND uj.id = ANY($2::int[])
        GROUP BY uj.id`,
        [user.id, journeyIds],
      );
      journeysResult.rows.forEach((j) => {
        journeysById.set(j.id, j);
      });
    }

    // Reassemble in the page's original order
    const items: TripsAndJourneysItem[] = [];
    for (const row of pageResult.rows) {
      if (row.type === "trip") {
        const trip = tripsById.get(row.item_id);
        if (trip) {
          items.push({ type: "trip", trip, journeys: tripJourneysByTripId.get(row.item_id) ?? [] });
        }
      } else {
        const journey = journeysById.get(row.item_id);
        if (journey) {
          items.push({ type: "journey", journey });
        }
      }
    }

    return { items, total };
  } catch (error) {
    console.error("Error fetching journeys and trips:", error);
    return { items: [], total: 0, error: "Failed to fetch journeys and trips" };
  }
}

/**
 * Get journeys not assigned to any trip (for the assignment picker)
 */
export async function getUnassignedJourneys(): Promise<{
  journeys: JourneyInTrip[];
  error?: string;
}> {
  try {
    const user = await getUser();
    if (!user) {
      return { journeys: [], error: "Not authenticated" };
    }

    const result = await pool.query<JourneyInTrip>(
      `SELECT
        uj.*,
        COUNT(ulp.id)::int as route_count,
        COALESCE(SUM(rr.length_km), 0) as total_distance
      FROM user_journeys uj
      LEFT JOIN user_logged_parts ulp ON uj.id = ulp.journey_id
      LEFT JOIN railway_routes rr ON ulp.track_id = rr.track_id
      WHERE uj.user_id = $1 AND uj.trip_id IS NULL
      GROUP BY uj.id
      ORDER BY uj.date DESC`,
      [user.id],
    );

    return { journeys: result.rows };
  } catch (error) {
    console.error("Error fetching unassigned journeys:", error);
    return { journeys: [], error: "Failed to fetch unassigned journeys" };
  }
}
