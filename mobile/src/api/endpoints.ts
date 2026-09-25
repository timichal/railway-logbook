/**
 * The endpoints the app calls, one function each.
 *
 * Thin by design: the client owns auth and refresh, so these say only what the
 * path and the shape are. `API.md` is the reference for both.
 *
 * The response types are declared here rather than imported from `@shared/*`,
 * because the shapes they mirror (`UserProgress` and friends) live in the query
 * modules alongside `pg` — server-only code. Only dependency-free modules cross
 * over; see `@shared` in `tsconfig.json`.
 */
import type { RegionId } from "@shared/regions";
import type {
  CoveredStretch,
  Journey,
  PlannerRoute,
  RailwayRoute,
  Station,
  Trip,
} from "@shared/types";
import { type AuthResponse, request } from "./client";

export interface ApiUser {
  id: number;
  email: string;
  name?: string;
}

export interface Progress {
  totalKm: number;
  completedKm: number;
  percentage: number;
  routePercentage: number;
  totalRoutes: number;
  completedRoutes: number;
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
    auth: false,
  });
}

export function register(input: {
  email: string;
  password: string;
  confirmPassword: string;
  name?: string;
}): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/register", { method: "POST", body: input, auth: false });
}

export async function me(): Promise<ApiUser> {
  const { user } = await request<{ user: ApiUser }>("/auth/me");
  return user;
}

// ============================================================================
// Public reads — no token; this is the same data the tiles serve to anyone
// ============================================================================

/**
 * Station-name autocomplete, region-scoped and `near_route` only — the same set the
 * map draws, so nothing searchable is invisible. Under two characters the server
 * answers with none rather than with the world.
 */
export async function stations(
  region: RegionId,
  q: string,
  signal?: AbortSignal,
): Promise<Station[]> {
  const { stations: found } = await request<{ stations: Station[] }>("/stations", {
    query: { region, q },
    auth: false,
    signal,
  });
  return found;
}

/**
 * The route rows behind a set of track ids, geometry excluded.
 *
 * A POST for a read because the id list is the argument. What it is for here is the
 * planner: its result identifies routes by id and endpoint name, and the selection
 * holds whole route features — so the ids are exchanged for the same properties the
 * tile would have carried, and a planned route is described exactly as a tapped one.
 */
export async function routeMetadata(trackIds: number[]): Promise<RailwayRoute[]> {
  const { routes } = await request<{ routes: RailwayRoute[] }>("/routes/metadata", {
    method: "POST",
    body: { trackIds },
    auth: false,
  });
  return routes;
}

/**
 * The journey planner. **"No path found" is a 200 with an `error` string**, not a
 * failure: the request was fine, the network simply doesn't connect those two
 * stations by regular-service routes, and that belongs next to the form rather than
 * in a catch block.
 */
export function plan(input: {
  fromStationId: number;
  toStationId: number;
  viaStationIds?: number[];
}): Promise<PlannerResult> {
  return request<PlannerResult>("/planner", { method: "POST", body: input, auth: false });
}

export interface PlannerResult {
  routes: PlannerRoute[];
  totalDistance: number;
  error?: string;
}

export function progress(region: RegionId, countries?: string[]): Promise<Progress> {
  // `countries` absent means no filter; an empty string means "filter everything
  // out", which is a real state and answers zeros. So an empty list must still be
  // sent as an empty value rather than dropped.
  return request<Progress>("/progress", {
    query: { region, countries: countries === undefined ? undefined : countries.join(",") },
  });
}

/** One country's share of the region, ridden against total. */
export interface CountryProgress {
  countryCode: string;
  countryName: string;
  totalKm: number;
  completedKm: number;
}

export interface ProgressByCountry {
  byCountry: CountryProgress[];
  total: { totalKm: number; completedKm: number };
}

/**
 * Per-country km plus the grand total — one row per country the region declares,
 * ridden or not, so the list is the region's countries and not just the visited ones.
 * Unfiltered by the user's own selection: this is what the selection is *made* from.
 */
export function progressByCountry(region: RegionId): Promise<ProgressByCountry> {
  return request<ProgressByCountry>("/progress/countries", { query: { region } });
}

/**
 * The stretches the user has ridden on routes they haven't finished, as drawable
 * geometry for the map's coverage overlay. Cut from the stored fraction ranges by the
 * server, because a tile carries one feature per route and this is a piece of one.
 */
export async function coverage(signal?: AbortSignal): Promise<CoveredStretch[]> {
  const { stretches } = await request<{ stretches: CoveredStretch[] }>("/coverage", { signal });
  return stretches;
}

export async function preferences(): Promise<string[]> {
  const { selectedCountries } = await request<{ selectedCountries: string[] }>("/preferences");
  return selectedCountries;
}

export function savePreferences(selectedCountries: string[]): Promise<void> {
  return request("/preferences", { method: "PUT", body: { selectedCountries } });
}

// ============================================================================
// Journeys and trips
// ============================================================================

/**
 * One route as the logging endpoints take it — an array of objects, not the three
 * positionally-aligned arrays the query module wants (`API.md`). `covered` is
 * dropped by the server unless `partial` is true.
 */
export interface LoggedRouteInput {
  trackId: number;
  partial?: boolean;
  covered?: { covered_start: number; covered_end: number };
}

/** A journey as the logbook list carries it: the row plus what it adds up to. */
export interface JourneyWithStats extends Journey {
  route_count: number;
  /** A Postgres numeric, so a string over the wire. */
  total_distance: string;
}

export interface TripWithStats extends Trip {
  journey_count: number;
  route_count: number;
  total_distance: string;
  start_date: string | null;
  end_date: string | null;
}

/**
 * One row of the logbook: a trip with its journeys nested, or a journey standing on
 * its own. The server orders and hydrates the page, so a client must not re-sort or
 * re-filter one — it would be sorting one page of a larger set.
 */
export type LogbookItem =
  | { type: "trip"; trip: TripWithStats; journeys: JourneyWithStats[] }
  | { type: "journey"; journey: JourneyWithStats };

export interface LogbookPage {
  items: LogbookItem[];
  total: number;
}

export function logbook(
  region: RegionId,
  options: { page?: number; pageSize?: number; search?: string } = {},
  signal?: AbortSignal,
): Promise<LogbookPage> {
  return request<LogbookPage>("/logbook", {
    query: {
      region,
      page: options.page,
      pageSize: options.pageSize,
      search: options.search || undefined,
    },
    signal,
  });
}

export async function createJourney(input: {
  name: string;
  date: string;
  description?: string;
  tripId?: number;
  routes: LoggedRouteInput[];
}): Promise<Journey> {
  const { journey } = await request<{ journey: Journey }>("/journeys", {
    method: "POST",
    body: input,
  });
  return journey;
}

/**
 * A route as `GET /journeys/:id` returns it: the route's own metadata (no geometry —
 * the map draws it from the tile) joined to how it was logged.
 */
export interface LoggedRoute extends Omit<RailwayRoute, "geometry"> {
  partial: boolean;
  /** The stretch ridden, both fields or neither — NULL means the extent is unknown. */
  covered_start?: number | null;
  covered_end?: number | null;
}

export function journey(id: number): Promise<{ journey: Journey; routes: LoggedRoute[] }> {
  return request(`/journeys/${id}`);
}

export async function updateJourney(
  id: number,
  input: { name: string; date: string; description?: string },
): Promise<Journey> {
  const { journey: updated } = await request<{ journey: Journey }>(`/journeys/${id}`, {
    method: "PATCH",
    body: input,
  });
  return updated;
}

export function deleteJourney(id: number): Promise<void> {
  return request(`/journeys/${id}`, { method: "DELETE" });
}

export async function trips(region: RegionId): Promise<TripWithStats[]> {
  const { trips: list } = await request<{ trips: TripWithStats[] }>("/trips", {
    query: { region },
  });
  return list;
}

export async function createTrip(input: { name: string; description?: string }): Promise<Trip> {
  const { trip } = await request<{ trip: Trip }>("/trips", { method: "POST", body: input });
  return trip;
}

export function trip(
  id: number,
): Promise<{ trip: TripWithStats; journeys: JourneyWithStats[]; routeIds: number[] }> {
  return request(`/trips/${id}`);
}

export async function updateTrip(
  id: number,
  input: { name: string; description?: string },
): Promise<Trip> {
  const { trip: updated } = await request<{ trip: Trip }>(`/trips/${id}`, {
    method: "PATCH",
    body: input,
  });
  return updated;
}

export function deleteTrip(id: number): Promise<void> {
  return request(`/trips/${id}`, { method: "DELETE" });
}

/** File a journey under a trip, or under none. Keyed on the journey: `trip_id` is its column. */
export function assignJourneyToTrip(journeyId: number, tripId: number | null): Promise<void> {
  return tripId === null
    ? request(`/journeys/${journeyId}/trip`, { method: "DELETE" })
    : request(`/journeys/${journeyId}/trip`, { method: "PUT", body: { tripId } });
}
