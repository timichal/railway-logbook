/**
 * Trip and logbook-list reads and writes, taking the user id explicitly.
 *
 * Plain module, not "use server" — same reasoning as `progressQueries.ts`.
 * `tripActions.ts` resolves the session and calls in; the mobile API's route
 * handlers resolve a bearer token and call the same functions
 * (MOBILE_APP_PLAN.md, Phase 1). A rejection meant for the caller is thrown as
 * a `ValidationError` or `NotFoundError`, as in `journeyQueries.ts`.
 */

import pool, { asMissingRow, escapeLikePattern } from "./db";
import { NotFoundError, ValidationError } from "./errors";
import { type RegionId, regionContainsSql } from "./shared/regions";
import type { Journey, Trip } from "./shared/types";

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
    SELECT bool_or(${regionContainsSql(region, "rr.starting_coordinate")})
    FROM user_logged_parts ulp_r
    JOIN railway_routes rr ON rr.track_id = ulp_r.track_id
    WHERE ulp_r.journey_id = ${journeyIdExpr}
  ), TRUE)`;
}

function tripInRegionSql(region: RegionId, tripIdExpr: string): string {
  return `COALESCE((
    SELECT bool_or(${regionContainsSql(region, "rr.starting_coordinate")})
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
  total_distance: number;
  start_date: string | null;
  end_date: string | null;
};

/**
 * Whether the logged part `ulp` carries the stretch it covered. A partial ride
 * ticked by hand has none, and like a whole ride it counts the route's full length
 * — the same rule the Route Logger's total follows (`loggedLengthKm`).
 */
const HAS_STRETCH_SQL =
  "ulp.partial AND ulp.covered_start IS NOT NULL AND ulp.covered_end IS NOT NULL";

/**
 * How far the logged part `ulp` of route `rr` went: the stretch travelled where it
 * is known, the whole line otherwise.
 */
const LOGGED_KM_SQL = `CASE WHEN ${HAS_STRETCH_SQL}
  THEN rr.length_km * (ulp.covered_end - ulp.covered_start)::numeric
  ELSE rr.length_km END`;

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
 * Its distance is how much of it the trip covered: the whole line if any journey
 * rode it whole (or partial with no known stretch, see HAS_STRETCH_SQL), otherwise
 * the union of the journeys' stretches — so two rides over the same stretch count
 * it once, and A–B plus B–C add up to A–C.
 *
 * `$1` must be the user id; callers may append further predicates on `ut`.
 * `tripIdsParam` (e.g. `"$2"`, an int[]) limits the aggregates to those trips:
 * the planner doesn't carry an outer `ut.id = ANY(...)` into the grouped
 * subqueries, so without it every trip the user has is aggregated and all but a
 * page of them thrown away.
 */
function tripStatsSql(tripIdsParam?: string): string {
  const tripsWhere = tripIdsParam
    ? `uj.trip_id = ANY(${tripIdsParam}::int[])`
    : "uj.trip_id IS NOT NULL";
  return `
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
    WHERE uj.user_id = $1 AND ${tripsWhere}
    GROUP BY uj.trip_id
  ) j ON j.trip_id = ut.id
  LEFT JOIN (
    SELECT tr.trip_id,
           COUNT(*)::int AS route_count,
           SUM(rr.length_km * CASE WHEN tr.whole THEN 1 ELSE (
             SELECT SUM(upper(s) - lower(s)) FROM unnest(tr.stretches) s
           ) END) AS total_distance
    FROM (
      SELECT uj.trip_id, ulp.track_id,
             bool_or(NOT (${HAS_STRETCH_SQL})) AS whole,
             range_agg(numrange(ulp.covered_start::numeric, ulp.covered_end::numeric))
               FILTER (WHERE ${HAS_STRETCH_SQL}) AS stretches
      FROM user_journeys uj
      JOIN user_logged_parts ulp ON ulp.journey_id = uj.id
      WHERE uj.user_id = $1 AND ${tripsWhere}
      GROUP BY uj.trip_id, ulp.track_id
    ) tr
    JOIN railway_routes rr ON rr.track_id = tr.track_id
    GROUP BY tr.trip_id
  ) r ON r.trip_id = ut.id
`;
}

/** A journey with its route count and distance, in a trip or standing alone. */
export type JourneyWithStats = Journey & {
  route_count: number;
  total_distance: number;
};

/**
 * The journeys of the user in placeholder `userParam` (e.g. `"$1"`) matching
 * `where` (a condition on `uj`), each with the number of its logged routes and how
 * far they went (LOGGED_KM_SQL). The user condition is written here, so no caller
 * can forget it.
 */
function journeyStatsSql(userParam: string, where: string, orderBy?: string): string {
  return `
    SELECT
      uj.*,
      COUNT(ulp.id)::int AS route_count,
      COALESCE(SUM(${LOGGED_KM_SQL}), 0) AS total_distance
    FROM user_journeys uj
    LEFT JOIN user_logged_parts ulp ON uj.id = ulp.journey_id
    LEFT JOIN railway_routes rr ON ulp.track_id = rr.track_id
    WHERE uj.user_id = ${userParam} AND (${where})
    GROUP BY uj.id
    ${orderBy ? `ORDER BY ${orderBy}` : ""}`;
}

/**
 * All of the user's trips with computed stats, scoped to `region`.
 *
 * This is the trip picker used when filing a journey under a trip, and a journey
 * is logged on the map of one region — so offering trips from the other side of
 * the planet only invites a misfile. A trip with no logged routes yet belongs to
 * every region (see tripInRegionSql), so a trip created empty can still be
 * picked in the region that created it.
 */
export async function tripsForUser(userId: number, region: RegionId): Promise<TripWithStats[]> {
  const result = await pool.query<TripWithStats>(
    `${tripStatsSql()}
     WHERE ut.user_id = $1
       AND ${tripInRegionSql(region, "ut.id")}
     ORDER BY j.end_date DESC NULLS LAST, ut.created_at DESC`,
    [userId],
  );
  return result.rows;
}

/** A single trip with its assigned journeys, and every route they logged. */
export async function tripForUser(
  userId: number,
  tripId: number,
): Promise<{ trip: Trip; journeys: JourneyWithStats[]; routeIds: number[] }> {
  // All three at once: the journey and route reads are scoped to the user, so
  // for someone else's trip they come back empty and are discarded with the 404
  const [tripResult, journeysResult, routeIdsResult] = await Promise.all([
    pool.query<Trip>("SELECT * FROM user_trips WHERE id = $1 AND user_id = $2", [tripId, userId]),
    pool.query<JourneyWithStats>(journeyStatsSql("$2", "uj.trip_id = $1", "uj.date ASC"), [
      tripId,
      userId,
    ]),
    pool.query<{ track_id: number }>(
      `SELECT DISTINCT ulp.track_id
      FROM user_logged_parts ulp
      JOIN user_journeys uj ON ulp.journey_id = uj.id
      WHERE uj.trip_id = $1 AND uj.user_id = $2`,
      [tripId, userId],
    ),
  ]);
  const trip = tripResult.rows[0];
  if (!trip) throw new NotFoundError("Trip not found");

  return {
    trip,
    journeys: journeysResult.rows,
    routeIds: routeIdsResult.rows.map((r) => r.track_id),
  };
}

function assertTripName(name: unknown): void {
  // Typed loosely because a server action's arguments are whatever the client sent
  if (typeof name !== "string" || name.trim() === "") {
    throw new ValidationError("Trip name is required");
  }
}

export async function createTripForUser(
  userId: number,
  name: string,
  description: string | null,
): Promise<Trip> {
  assertTripName(name);
  const result = await pool.query<Trip>(
    `INSERT INTO user_trips (user_id, name, description)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, name.trim(), description],
  );
  return result.rows[0];
}

/** Update trip metadata (name, description). */
export async function updateTripForUser(
  userId: number,
  tripId: number,
  name: string,
  description: string | null,
): Promise<Trip> {
  assertTripName(name);
  const result = await pool.query<Trip>(
    `UPDATE user_trips
     SET name = $1, description = $2
     WHERE id = $3 AND user_id = $4
     RETURNING *`,
    [name.trim(), description, tripId, userId],
  );
  if (result.rows.length === 0) throw new NotFoundError("Trip not found");
  return result.rows[0];
}

/** Delete a trip (journeys get unassigned via ON DELETE SET NULL). */
export async function deleteTripForUser(userId: number, tripId: number): Promise<void> {
  const result = await pool.query("DELETE FROM user_trips WHERE id = $1 AND user_id = $2", [
    tripId,
    userId,
  ]);
  if (result.rowCount === 0) throw new NotFoundError("Trip not found");
}

export async function assignJourneyToTripForUser(
  userId: number,
  journeyId: number,
  tripId: number,
): Promise<void> {
  // A null would pass the FK (MATCH SIMPLE skips it) and unfile the journey,
  // which is unassignJourneyFromTripForUser's job, not this one's
  if (!Number.isInteger(tripId)) throw new ValidationError("Trip id is required");

  // A trip that isn't the user's fails the composite FK (trip_id, user_id),
  // which asMissingRow answers as "Trip not found"
  const result = await pool
    .query("UPDATE user_journeys SET trip_id = $1 WHERE id = $2 AND user_id = $3", [
      tripId,
      journeyId,
      userId,
    ])
    .catch((error: unknown) => {
      throw asMissingRow(error);
    });
  if (result.rowCount === 0) throw new NotFoundError("Journey not found");
}

/** File a journey under no trip. */
export async function unassignJourneyFromTripForUser(
  userId: number,
  journeyId: number,
): Promise<void> {
  const result = await pool.query(
    "UPDATE user_journeys SET trip_id = NULL WHERE id = $1 AND user_id = $2",
    [journeyId, userId],
  );
  if (result.rowCount === 0) throw new NotFoundError("Journey not found");
}

// One row in the merged trips+journeys list. A trip carries its assigned journeys; a standalone journey stands on its own.
export type TripsAndJourneysItem =
  | { type: "trip"; trip: TripWithStats; journeys: JourneyWithStats[] }
  | { type: "journey"; journey: JourneyWithStats };

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
): Promise<{ items: TripsAndJourneysItem[]; total: number }> {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
  const offset = (safePage - 1) * safePageSize;
  const searchPattern = search.trim()
    ? `%${escapeLikePattern(search.trim().toLowerCase())}%`
    : null;

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

  // Page of (type, id) ordered by effective_date desc, then created_at desc as
  // tiebreaker, each row carrying the total count for the pagination UI (the
  // window runs before LIMIT) — one statement, so the count matches the page
  const params: (string | number)[] = searchPattern ? [userId, searchPattern] : [userId];
  const pageResult = await pool.query<{ type: "trip" | "journey"; item_id: number; total: number }>(
    `${baseCte}
     SELECT type, item_id, COUNT(*) OVER ()::int AS total FROM ordered
     ORDER BY effective_date DESC NULLS FIRST, sort_created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, safePageSize, offset],
  );
  // A page past the end has no row to carry the count, so it is asked for apart
  const total =
    pageResult.rows[0]?.total ??
    (offset > 0
      ? (
          await pool.query<{ total: number }>(
            `${baseCte} SELECT COUNT(*)::int AS total FROM ordered`,
            params,
          )
        ).rows[0].total
      : 0);

  const tripIds = pageResult.rows.filter((r) => r.type === "trip").map((r) => r.item_id);
  const journeyIds = pageResult.rows.filter((r) => r.type === "journey").map((r) => r.item_id);

  // Hydrate the page: its trips (with stats), the journeys assigned to those
  // trips (one query for all), and its standalone journeys
  const [trips, tripJourneys, journeys] = await Promise.all([
    tripIds.length > 0
      ? pool
          .query<TripWithStats>(
            `${tripStatsSql("$2")}
             WHERE ut.user_id = $1 AND ut.id = ANY($2::int[])`,
            [userId, tripIds],
          )
          .then((r) => r.rows)
      : [],
    tripIds.length > 0
      ? pool
          .query<JourneyWithStats>(
            journeyStatsSql("$1", "uj.trip_id = ANY($2::int[])", "uj.date ASC"),
            [userId, tripIds],
          )
          .then((r) => r.rows)
      : [],
    journeyIds.length > 0
      ? pool
          .query<JourneyWithStats>(journeyStatsSql("$1", "uj.id = ANY($2::int[])"), [
            userId,
            journeyIds,
          ])
          .then((r) => r.rows)
      : [],
  ]);

  const tripsById = new Map(trips.map((t) => [t.id, t]));
  const journeysById = new Map(journeys.map((j) => [j.id, j]));
  const tripJourneysByTripId = Map.groupBy(tripJourneys, (j) => j.trip_id);

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
): Promise<JourneyWithStats[]> {
  const result = await pool.query<JourneyWithStats>(
    journeyStatsSql(
      "$1",
      `uj.trip_id IS NULL AND ${journeyInRegionSql(region, "uj.id")}`,
      "uj.date DESC",
    ),
    [userId],
  );
  return result.rows;
}
