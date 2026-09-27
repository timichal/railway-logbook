/**
 * What stretch of each route a planned journey covers. Pure: it works from the
 * segments the search returned and the stations' fractions along their routes,
 * and says which fraction range to cut — `routePathFinder.ts` does the cutting.
 */

import { UNTRAVELLED_NOISE_KM } from "../shared/routeCoverage";
import { type EndpointSide, type NetworkRoute, oppositeSide } from "./routeGraph";
import type { SearchResult } from "./routeSearch";
import type { StationRouteMatch } from "./stations";

/**
 * How much untravelled track a terminal route must be left with before the plan
 * calls it partial.
 *
 * A station projects a few metres inside the route that starts there — its
 * endpoint is a hand-picked click point, not the platform centre — so tiny
 * remainders are noise rather than track the journey misses. The same number,
 * from the same reasoning, is the tolerance that lets several partial rides add
 * up to a complete route (`routeCoverage.ts`).
 */
const MIN_UNTRAVELLED_KM = UNTRAVELLED_NOISE_KM;

/** The fraction range of a route's geometry that the journey actually covers. */
export interface TrimSpec {
  trackId: number;
  lo: number;
  hi: number;
}

/**
 * One unbroken stay on a route, with every point the journey touches on it — an
 * endpoint (0 or 1) or a stop (its fraction along the route; undefined if it
 * could not be located there). The covered stretch is the span of those points:
 * an intermediate route touches both endpoints and is whole, a route joined at a
 * stop runs from that stop to the endpoint it is left through, and an
 * out-and-back that turns at a via covers the endpoint (or stop) it came from up
 * to the via.
 */
export interface RouteVisit {
  trackId: number;
  fracs: (number | undefined)[];
}

/**
 * Turn the per-segment searches into route visits, merging the visit a segment
 * ends with into the one the next segment starts with when both are on the same
 * route — the journey passed through the via station without leaving it.
 *
 * Within a segment, the first route is joined at the segment's from-station and
 * the last left at its to-station; every other point is an endpoint, as the
 * search reports it (`SearchResult.sides`). The last route's reported side is
 * the one beyond the destination, so it is entered through the opposite one. A
 * segment on a single route reports no side and touches only its two stations.
 *
 * Every stop is therefore a point on the route the journey is on when it gets
 * there — a via included, whichever route it arrived on and whichever it leaves
 * on — so a route joined or left mid-way at a via is trimmed exactly as the
 * first and last route of the plan are.
 *
 * `stations` is `findRoutesNearStations`' own: every route a stop is a point on
 * was picked from the routes it matched to that stop, so where the stop sits
 * along it is already known.
 */
export function planVisits(
  segments: SearchResult[],
  stationSequence: number[],
  stations: Map<number, StationRouteMatch>,
): RouteVisit[] {
  const visits: RouteVisit[] = [];
  const endpointFrac = (side: EndpointSide) => (side === "start" ? 0 : 1);

  segments.forEach((segment, i) => {
    const fromFractions = stations.get(stationSequence[i])?.fractions;
    const toFractions = stations.get(stationSequence[i + 1])?.fractions;
    const last = segment.path.length - 1;

    segment.path.forEach((trackId, j) => {
      // Null only on a single-route segment, whose one route is both first and last
      const side = segment.sides[j];
      const fracs = [
        j === 0 || !side ? fromFractions?.get(trackId) : endpointFrac(oppositeSide(side)),
        j === last || !side ? toFractions?.get(trackId) : endpointFrac(side),
      ];

      const previous = visits[visits.length - 1];
      if (j === 0 && previous?.trackId === trackId) {
        previous.fracs.push(...fracs);
      } else {
        visits.push({ trackId, fracs });
      }
    });
  });

  return visits;
}

/**
 * Which route visits to cut down to the stretch the journey covers, and which
 * routes it barely touches at all.
 *
 * Intermediate routes come out whole — the search enters a route at one endpoint
 * and leaves at the other — but a route joined or left at a stop is covered only
 * from that stop (e.g. Nový Bor, halfway along Jedlová ⟷ Česká Lípa). Which
 * endpoints are touched comes from `sides`, which the search reports for the hops
 * it actually took, rather than being inferred from the routes' closest endpoint
 * pairing (see `planVisits`).
 *
 * A plan on a single route covers the span of every stop along it, vias
 * included, so an out-and-back (A via B to A) covers A–B rather than nothing.
 *
 * A route the journey barely touches — its stop within MIN_UNTRAVELLED_KM of the
 * endpoint the journey enters or leaves through — comes back in `untravelled`
 * rather than as a trim: the station projecting a few metres inside the route is
 * the same noise that tolerance absorbs elsewhere, and dropping a zero-width trim
 * as "leaves nothing out" would count the route at full length. A single-route
 * plan is only untravelled when every stop sits on one point.
 *
 * A route left with under MIN_UNTRAVELLED_KM of untravelled track gets no trim,
 * and neither does one visited twice or one whose stop could not be located on
 * it: those stay whole.
 */
export function planTrims(
  visits: RouteVisit[],
  routeInfo: Map<number, NetworkRoute>,
): { trims: TrimSpec[]; untravelled: Set<number> } {
  const untravelled = new Set<number>();

  // A route visited twice (possible across via segments) has no single covered
  // stretch, so leave it whole rather than guess.
  const visitCounts = new Map<number, number>();
  for (const { trackId } of visits) {
    visitCounts.set(trackId, (visitCounts.get(trackId) ?? 0) + 1);
  }

  const specs: TrimSpec[] = [];
  for (const { trackId, fracs } of visits) {
    if (visitCounts.get(trackId) !== 1) continue;
    if (!fracs.every((frac): frac is number => frac !== undefined)) continue;
    specs.push({ trackId, lo: Math.min(...fracs), hi: Math.max(...fracs) });
  }

  // Set aside the ones that cover nothing, and drop those that leave nothing out
  const trims = specs.filter((spec) => {
    // Every route on a plan came out of the graph, so routeInfo has it
    const fullKm = routeInfo.get(spec.trackId)!.length_km;
    const width = spec.hi - spec.lo;
    const barelyEntered = visits.length > 1 && fullKm * width < MIN_UNTRAVELLED_KM;
    if (width <= 0 || barelyEntered) {
      untravelled.add(spec.trackId);
      return false;
    }
    return fullKm * (1 - width) >= MIN_UNTRAVELLED_KM;
  });

  return { trims, untravelled };
}
