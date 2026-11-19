/**
 * The endpoints the app calls, one function each.
 *
 * Thin by design: the client owns auth and refresh, so these say only what the
 * path and the shape are. `API.md` is the reference for both.
 *
 * Most response types are declared here rather than imported from `@shared/*`,
 * because the shapes they mirror live in the query modules alongside `pg` —
 * server-only code. Only dependency-free modules cross over (the progress
 * figures, `@shared/progress`); see `@shared` in `tsconfig.json`.
 */

import type { UsageType } from "@shared/constants";
import type { RouteRide } from "@shared/map/routeRides";
import type { ProgressByCountry, UserProgress } from "@shared/progress";
import type { RegionId } from "@shared/regions";
import type {
  CoveredStretch,
  Journey,
  LineGeometry,
  MapSearchResults,
  PartialRouteGeometry,
  PlannerRoute,
  RailwayRoute,
  RouteBounds,
  Station,
  Trip,
} from "@shared/types";
import { type ApiUser, type AuthResponse, request } from "./client";

export type Progress = UserProgress;

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

/** The account and everything in it, gone. A wrong password is a 400, never a sign-out. */
export async function deleteAccount(password: string): Promise<void> {
  await request("/auth/me", { method: "DELETE", body: { password } });
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
 * The map's search box: the stations `stations` finds, and the lines where the
 * region names them (`hasRouteNames`; empty elsewhere), in one request.
 */
export function mapSearch(
  region: RegionId,
  q: string,
  signal?: AbortSignal,
): Promise<MapSearchResults> {
  return request<MapSearchResults>("/search", { query: { region, q }, auth: false, signal });
}

/** A line picked in the map's search box, merged per usage type for its band. */
export async function lineGeometry(
  region: RegionId,
  name: string,
  signal?: AbortSignal,
): Promise<LineGeometry[]> {
  const { lines } = await request<{ lines: LineGeometry[] }>("/lines/geometry", {
    query: { region, name },
    auth: false,
    signal,
  });
  return lines;
}

/**
 * The route rows behind a set of track ids, geometry excluded.
 *
 * A POST for a read because the id list is the argument. What it is for here is the
 * planner: its result identifies routes by id and endpoint name, and the selection
 * holds whole route features — so the ids are exchanged for the same properties the
 * tile would have carried, and a planned route is described exactly as a tapped one.
 */
export async function routeMetadata(
  trackIds: number[],
  signal?: AbortSignal,
): Promise<RailwayRoute[]> {
  const { routes } = await request<{ routes: RailwayRoute[] }>("/routes/metadata", {
    method: "POST",
    body: { trackIds },
    auth: false,
    signal,
  });
  return routes;
}

/**
 * The version the route tile URL carries now, for Martin's cached route source
 * (`useRoutesTileVersion`). It moves with every change to the tile, so a URL built
 * from it is never served stale.
 */
export async function routesTileVersion(signal?: AbortSignal): Promise<string> {
  const { version } = await request<{ version: string }>("/routes/tile-version", {
    auth: false,
    signal,
  });
  return version;
}

/**
 * The journey planner. **"No path found" is a 200 with an `error` string**, not a
 * failure: the request was fine, the network simply doesn't connect those two
 * stations by the routes searched, and that belongs next to the form rather than in a
 * catch block.
 *
 * `includeSpecial` lets the search ride Special routes too, where the region counts
 * them as ordinary (`ordinaryUsageTypes` — Japan's non-JR lines; in Europe it changes
 * nothing). `includeClosed` lets it ride closed lines too, asked for while the map
 * shows every closed line. Absent means false, for both.
 */
export function plan(input: {
  fromStationId: number;
  toStationId: number;
  viaStationIds?: number[];
  includeSpecial?: boolean;
  includeClosed?: boolean;
}): Promise<PlannerResult> {
  return request<PlannerResult>("/planner", { method: "POST", body: input, auth: false });
}

export interface PlannerResult {
  routes: PlannerRoute[];
  totalDistance: number;
  /** What the map fits to — the travelled stretch on a partial route. Null with `error`. */
  bounds: RouteBounds | null;
  error?: string;
}

export function progress(
  region: RegionId,
  countries?: readonly string[],
  usage?: readonly UsageType[],
): Promise<Progress> {
  // Both lists: absent means no filter; an empty string means "filter everything
  // out", which is a real state and answers zeros. So an empty list must still be
  // sent as an empty value rather than dropped. `usage` is the counted types the map
  // shows (Japan's JR and non-JR lines are ticked like countries).
  return request<Progress>("/progress", {
    query: {
      region,
      countries: countries === undefined ? undefined : countries.join(","),
      usage: usage === undefined ? undefined : usage.join(","),
    },
  });
}

export type { CountryProgress, ProgressByCountry, UsageProgress } from "@shared/progress";

/**
 * Per-country and per-line-type km plus the grand total — one row per country the
 * region declares and per usage type it counts, ridden or not, so the lists are the
 * region's and not just the visited ones. Unfiltered by the user's own selection:
 * this is what the selection is *made* from.
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

/**
 * Every route the user has ridden, for the map's colours: Martin's route tile is
 * the same for everyone, and these are laid over it by id (`useRides`).
 */
export async function rides(signal?: AbortSignal): Promise<RouteRide[]> {
  const { rides } = await request<{ rides: RouteRide[] }>("/rides", { signal });
  return rides;
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
  total_distance: number;
}

export interface TripWithStats extends Trip {
  journey_count: number;
  route_count: number;
  total_distance: number;
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

/**
 * A journey and its routes, with `bounds` — the box of those routes in `region`, which
 * the map fits to when the journey is opened, `null` when none is there — and
 * `partials`, the stretch ridden of each route logged in part where it is known,
 * which the highlight draws in place of the whole route. The routes come in the order
 * they were logged, with each one's `ends`, which is what `journeyChains` reads.
 */
export interface LoadedJourney {
  journey: Journey;
  routes: LoggedRoute[];
  bounds: RouteBounds | null;
  partials: PartialRouteGeometry[];
}

export function journey(
  id: number,
  region: RegionId,
  signal?: AbortSignal,
): Promise<LoadedJourney> {
  return request(`/journeys/${id}`, { query: { region }, signal });
}

/**
 * An edit of a journey as a whole, saved in one transaction: only what changed is
 * sent, and a field left out keeps what the journey holds now (it may have changed
 * on the web meanwhile). `upsert` routes are written as sent, so one without
 * `covered` has no stretch; `tripId: null` files it under none.
 */
export interface JourneyEditInput {
  name?: string;
  date?: string;
  /** Null clears it. */
  description?: string | null;
  tripId?: number | null;
  upsert?: LoggedRouteInput[];
  remove?: number[];
}

export async function updateJourney(id: number, edits: JourneyEditInput): Promise<void> {
  await request(`/journeys/${id}`, { method: "PATCH", body: edits });
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

/** A trip, its journeys and their track ids, with `bounds` and `partials` as `journey` has them. */
export function trip(
  id: number,
  region: RegionId,
): Promise<{
  trip: TripWithStats;
  journeys: JourneyWithStats[];
  routeIds: number[];
  partials: PartialRouteGeometry[];
  bounds: RouteBounds | null;
}> {
  return request(`/trips/${id}`, { query: { region } });
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
