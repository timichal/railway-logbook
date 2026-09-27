/**
 * Shared coordinate utilities for route geometry processing
 */

export type Coord = [number, number];

/**
 * Convert a coordinate to a string key rounded to 7 decimal places (~1cm),
 * so that endpoints originating from the same OSM node match despite tiny
 * floating-point differences.
 */
export function coordinateToKey(coord: Coord): string {
  return `${coord[0].toFixed(7)},${coord[1].toFixed(7)}`;
}

/** Whether every point of a sublist is the same point, i.e. it has no length. */
function isZeroLength(sublist: Coord[]): boolean {
  const firstKey = coordinateToKey(sublist[0]);
  return sublist.every((coord) => coordinateToKey(coord) === firstKey);
}

/**
 * Merges coordinate sublists, given in path order, into a single linear chain.
 *
 * The first sublist sets the direction: it runs from the route's start toward
 * the second (reversed only if it plainly faces the other way). Each following
 * sublist is then oriented so it continues from the chain's tail.
 *
 * The order is taken from the caller rather than worked out from which
 * endpoints occur once: a start click exactly on a shared node truncates the
 * first part to a single point, which leaves no endpoint unique at the start,
 * and the chain used to be built from the far end — a route stored backwards.
 * Zero-length sublists are skipped for the same reason; they add no track.
 *
 * All coordinate comparisons go through {@link coordinateToKey}, so matching
 * agrees on what counts as "the same point".
 *
 * @param sublists - Coordinate arrays in the order the path travels them
 * @returns A single merged coordinate array, from the path's start to its end
 * @throws Error if the chain is broken
 */
export function mergeLinearChain(sublists: Coord[][]): Coord[] {
  const nonEmpty = sublists.filter((sublist) => sublist.length > 0);
  if (nonEmpty.length === 0) return [];
  if (nonEmpty.length === 1) return nonEmpty[0];

  const [first, ...rest] = nonEmpty;
  const next = rest[0];
  const touchesNext = (coord: Coord) => {
    const key = coordinateToKey(coord);
    return key === coordinateToKey(next[0]) || key === coordinateToKey(next[next.length - 1]);
  };

  // A zero-length first part is just the start point; otherwise it should end
  // where the second part begins
  let mergedChain: Coord[];
  if (isZeroLength(first)) {
    mergedChain = [first[0]];
  } else if (touchesNext(first[first.length - 1])) {
    mergedChain = [...first];
  } else if (touchesNext(first[0])) {
    mergedChain = [...first].reverse();
  } else {
    throw new Error("Chain is broken; no connecting sublist found.");
  }

  for (const sublist of rest) {
    const tailKey = coordinateToKey(mergedChain[mergedChain.length - 1]);

    // Only the sublists' own endpoints count as connections — that is how the
    // pathfinder graph is built (parts are adjacent when they share a first/last
    // coordinate). Matching a coordinate in the *middle* of a sublist would
    // splice in a segment that doesn't start at the chain's tail, silently
    // producing a geometry with a jump in it.
    let oriented: Coord[];
    if (coordinateToKey(sublist[0]) === tailKey) {
      oriented = sublist;
    } else if (coordinateToKey(sublist[sublist.length - 1]) === tailKey) {
      oriented = [...sublist].reverse();
    } else {
      throw new Error("Chain is broken; no connecting sublist found.");
    }

    if (isZeroLength(oriented)) continue;
    mergedChain.push(...oriented.slice(1));
  }

  // Every part was zero-length (both clicks on one shared node): still a
  // LINESTRING, which needs two points, as the chain was before any were skipped
  return mergedChain.length > 1 ? mergedChain : [mergedChain[0], mergedChain[0]];
}

/**
 * Converts an array of coordinates to WKT LINESTRING format
 * @param coordinates - Array of [lon, lat] coordinates
 * @returns WKT LINESTRING string
 */
export function coordinatesToWKT(coordinates: Coord[]): string {
  return `LINESTRING(${coordinates.map((coord) => `${coord[0]} ${coord[1]}`).join(",")})`;
}
