/**
 * Trip and logbook-list reads and writes, taking the user id explicitly.
 *
 * Plain module, not "use server" — same reasoning as `progressQueries.ts`.
 * `tripActions.ts` resolves the session and calls in; the mobile API's route
 * handlers resolve a bearer token and call the same functions
 * (MOBILE_APP_PLAN.md, Phase 1). Failures come back in-band as `{ error }`,
 * which the handlers turn into a status code.
 */

import pool from "./db";
import { type RegionId, regionEnvelopeSql } from "./regions";
import type { Journey, Trip } from "./types";

/**
 * Region predicates for the browsing list.
 *
 * A journey belongs to a region when it logged at least one route there; a trip,
 * when any of its journeys did. Something with no logged routes yet belongs to
 * every region — `bool_or` over no rows is NULL, and the COALESCE turns that
 * into "show it", so a journey created empty never disappears from the list that
 * created it. A journey spanning both regions (which nothing realistic does)
 * shows up in both, which is the honest answer.
 */
function journeyInRegionSql(region: RegionId, journeyIdExpr: string): string {
  return `COALESCE((
    SELECT bool_or(rr.geometry && ${regionEnvelopeSql(region)})
    FROM user_logged_parts ulp_r
    JOIN railway_routes rr ON rr.track_id = ulp_r.track_id
    WHERE ulp_r.journey_id = ${journeyIdExpr}
  ), TRUE)`;
}

function tripInRegionSql(region: RegionId, tripIdExpr: string): string {
  return `COALESCE((
    SELECT bool_or(rr.geometry && ${regionEnvelopeSql(region)})
    FROM user_journeys uj_r
    JOIN user_logged_parts ulp_r ON ulp_r.journey_id = uj_r.id
    JOIN railway_routes rr ON rr.track_id = ulp_r.track_id
    WHERE uj_r.trip_id = ${tripIdExpr}
  ), TRUE)`;
}

// Trip with computed stats from joined journey data
export type TripWithStats = Trip & {
  journey_count: number;
  route_count: number;
  total_distance: string;
  start_date: string | null;
  end_date: string | null;
};

/**
 * Trip stats SELECT, shared by getAllTrips and getJourneysAndTrips.
 *
 * Journey and route stats are aggregated in separate subqueries rather than by
 * joining user_journeys × user_logged_parts directly: that join fans out (one
 * row per logged part per journey), which double-counts a route logged in two
 * journeys of the same trip. Both counts and the distance are therefore taken
 * over DISTINCT (trip_id, track_id) — a route ridden on several days of the
 * same trip counts once.
 *
 * `$1` must be the user id; callers may append further predicates on `ut`.
 */
const TRIP_STATS_SELECT = `
  SELECT
    ut.*,
    COALESCE(j.journey_count, 0) AS journey_count,
    COALESCE(r.route_count, 0) AS route_count,
    COALESCE(r.total_distance, 0) AS total_distance,
    j.start_date,
    j.end_date
  FROM user_trips ut
  LEFT JOIN (
    SELECT uj.trip_id,
           COUNT(*)::int AS journey_count,
           MIN(uj.date)::text AS start_date,
           MAX(uj.date)::text AS end_date
    FROM user_journeys uj
    WHERE uj.user_id = $1 AND uj.trip_id IS NOT NULL
    GROUP BY uj.trip_id
  ) j ON j.trip_id = ut.id
  LEFT JOIN (
    SELECT tr.trip_id,
           COUNT(*)::int AS route_count,
           SUM(rr.length_km) AS total_distance
    FROM (
      SELECT DISTINCT uj.trip_id, ulp.track_id
      FROM user_journeys uj
      JOIN user_logged_parts ulp ON ulp.journey_id = uj.id
      WHERE uj.user_id = $1 AND uj.trip_id IS NOT NULL AND ulp.track_id IS NOT NULL
    ) tr
    JOIN railway_routes rr ON rr.track_id = tr.track_id
    GROUP BY tr.trip_id
  ) r ON r.trip_id = ut.id
`;

// Journey with route stats (used in trip detail view)
export type JourneyInTrip = Journey & {
  route_count: number;
  total_distance: string;
};

/**
 * All of the user's trips with computed stats, scoped to `region`.
 *
 * This is the trip picker used when filing a journey under a trip, and a journey
 * is logged on the map of one region — so offering trips from the other side of
 * the planet only invites a misfile. A trip with no logged routes yet belongs to
 * every region (see tripInRegionSql), so a trip created empty can still be
 * picked in the region that created it.
 */
export async function tripsForUser(
  userId: number,
  region: RegionId,
): Promise<{
  trips: TripWithStats[];
  error?: string;
}> {
  try {
    const result = await pool.query<TripWithStats>(
      `${TRIP_STATS_SELECT}
       WHERE ut.user_id = $1
         AND ${tripInRegionSql(region, "ut.id")}
       ORDER BY j.end_date DESC NULLS LAST, ut.created_at DESC`,
      [userId],
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
export async function tripForUser(
  userId: number,
  tripId: number,
): Promise<{
  trip: Trip | null;
  journeys: JourneyInTrip[];
  routeIds: number[];
  error?: string;
}> {
  try {
    const tripResult = await pool.query<Trip>(
      "SELECT * FROM user_trips WHERE id = $1 AND user_id = $2",
      [tripId, userId],
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
      [tripId, userId],
    );

    // Fetch all distinct route IDs across all journeys in this trip
    const routeIdsResult = await pool.query<{ track_id: number }>(
      `SELECT DISTINCT ulp.track_id
      FROM user_logged_parts ulp
      JOIN user_journeys uj ON ulp.journey_id = uj.id
      WHERE uj.trip_id = $1 AND uj.user_id = $2 AND ulp.track_id IS NOT NULL`,
      [tripId, userId],
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
export async function createTripForUser(
  userId: number,
  name: string,
  description: string | null,
): Promise<{ trip: Trip | null; error?: string }> {
  try {
    if (!name || name.trim() === "") {
      return { trip: null, error: "Trip name is required" };
    }

    const result = await pool.query<Trip>(
      `INSERT INTO user_trips (user_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, name.trim(), description],
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
export async function updateTripForUser(
  userId: number,
  tripId: number,
  name: string,
  description: string | null,
): Promise<{ trip: Trip | null; error?: string }> {
  try {
    if (!name || name.trim() === "") {
      return { trip: null, error: "Trip name is required" };
    }

    const result = await pool.query<Trip>(
      `UPDATE user_trips
       SET name = $1, description = $2
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [name.trim(), description, tripId, userId],
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
export async function deleteTripForUser(
  userId: number,
  tripId: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await pool.query("DELETE FROM user_trips WHERE id = $1 AND user_id = $2", [
      tripId,
      userId,
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
export async function assignJourneyToTripForUser(
  userId: number,
  journeyId: number,
  tripId: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Verify trip belongs to user
    const tripCheck = await pool.query("SELECT id FROM user_trips WHERE id = $1 AND user_id = $2", [
      tripId,
      userId,
    ]);
    if (tripCheck.rows.length === 0) {
      return { success: false, error: "Trip not found" };
    }

    const result = await pool.query(
      "UPDATE user_journeys SET trip_id = $1 WHERE id = $2 AND user_id = $3",
      [tripId, journeyId, userId],
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
export async function unassignJourneyFromTripForUser(
  userId: number,
  journeyId: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await pool.query(
      "UPDATE user_journeys SET trip_id = NULL WHERE id = $1 AND user_id = $2",
      [journeyId, userId],
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
 *
 * Scoped to `region` (see journeyInRegionSql): browsing the list highlights the
 * item's routes on the map, and the map is locked to one region. The trip picker
 * (getAllTrips) and the journey picker (getUnassignedJourneys) are scoped the
 * same way.
 */
export async function journeysAndTripsForUser(
  userId: number,
  page: number,
  pageSize: number,
  search: string,
  region: RegionId,
): Promise<{ items: TripsAndJourneysItem[]; total: number; error?: string }> {
  try {
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
          AND ${tripInRegionSql(region, "ut.id")}
          ${searchPattern ? `AND (LOWER(ut.name) LIKE $2 OR LOWER(COALESCE(ut.description, '')) LIKE $2)` : ""}
        GROUP BY ut.id

        UNION ALL

        SELECT 'journey'::text AS type, uj.id AS item_id,
               uj.date::text AS effective_date,
               uj.created_at AS sort_created_at
        FROM user_journeys uj
        WHERE uj.user_id = $1 AND uj.trip_id IS NULL
          AND ${journeyInRegionSql(region, "uj.id")}
          ${searchPattern ? `AND (LOWER(uj.name) LIKE $2 OR LOWER(COALESCE(uj.description, '')) LIKE $2 OR uj.date::text LIKE $2)` : ""}
      )
    `;

    // Total count for pagination UI
    const countParams: (string | number)[] = [userId];
    if (searchPattern) countParams.push(searchPattern);
    const countResult = await pool.query<{ total: string }>(
      `${baseCte} SELECT COUNT(*)::text AS total FROM ordered`,
      countParams,
    );
    const total = parseInt(countResult.rows[0]?.total ?? "0", 10);

    // Page of (type, id) ordered by effective_date desc, then created_at desc as tiebreaker
    const pageParams: (string | number)[] = [userId];
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
        `${TRIP_STATS_SELECT}
         WHERE ut.user_id = $1 AND ut.id = ANY($2::int[])`,
        [userId, tripIds],
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
        [userId, tripIds],
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
        [userId, journeyIds],
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
 * Get journeys not assigned to any trip (for the assignment picker), scoped to
 * `region` — the same reason as getAllTrips: the picker offers journeys to file
 * under a trip being browsed on one region's map, and a journey from the other
 * region has no business in that list. A journey with no logged routes yet
 * belongs to every region (see journeyInRegionSql), so an empty one stays
 * fileable.
 */
export async function unassignedJourneysForUser(
  userId: number,
  region: RegionId,
): Promise<{
  journeys: JourneyInTrip[];
  error?: string;
}> {
  try {
    const result = await pool.query<JourneyInTrip>(
      `SELECT
        uj.*,
        COUNT(ulp.id)::int as route_count,
        COALESCE(SUM(rr.length_km), 0) as total_distance
      FROM user_journeys uj
      LEFT JOIN user_logged_parts ulp ON uj.id = ulp.journey_id
      LEFT JOIN railway_routes rr ON ulp.track_id = rr.track_id
      WHERE uj.user_id = $1 AND uj.trip_id IS NULL
        AND ${journeyInRegionSql(region, "uj.id")}
      GROUP BY uj.id
      ORDER BY uj.date DESC`,
      [userId],
    );

    return { journeys: result.rows };
  } catch (error) {
    console.error("Error fetching unassigned journeys:", error);
    return { journeys: [], error: "Failed to fetch unassigned journeys" };
  }
}
