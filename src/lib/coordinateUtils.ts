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

/**
 * Merges a list of coordinate sublists into a single linear chain.
 * This algorithm properly orders and connects coordinate arrays from multiple railway parts
 * by finding the starting point and building the chain incrementally.
 *
 * Algorithm:
 * 1. Find coordinate frequencies to identify potential endpoints (frequency = 1)
 * 2. If no clear endpoint, use the first sublist as starting point
 * 3. Build the chain by finding connecting sublists and adding them in order
 *
 * All coordinate comparisons go through {@link coordinateToKey}, so endpoint
 * detection and chain building agree on what counts as "the same point".
 *
 * @param sublists - Array of coordinate arrays to merge
 * @param log - Where to report an ambiguous chain. A bulk recalculation runs
 *   thousands of merges and passes a no-op, so the note does not bury the
 *   progress line; it used to be swallowed by the global `console.log` the
 *   recalculation patched out around each search.
 * @returns A single merged coordinate array in the correct order
 * @throws Error if the chain is broken
 */
export function mergeLinearChain(
  sublists: Coord[][],
  log: (message: string) => void = console.log,
): Coord[] {
  if (sublists.length === 0) return [];
  if (sublists.length === 1) return sublists[0];

  // Make a copy to avoid mutating the original
  const remainingSublists = sublists.map((s) => [...s]);

  // Step 1: Create a map of coordinate frequencies
  const coordCount = new Map<string, number>();
  remainingSublists.forEach((sublist) => {
    const firstKey = coordinateToKey(sublist[0]);
    const lastKey = coordinateToKey(sublist[sublist.length - 1]);
    coordCount.set(firstKey, (coordCount.get(firstKey) || 0) + 1);
    coordCount.set(lastKey, (coordCount.get(lastKey) || 0) + 1);
  });

  // Step 2: Find the starting sublist (prefer one with an endpoint that appears only once)
  let startingSublistIndex = remainingSublists.findIndex((sublist) => {
    const firstCoord = coordinateToKey(sublist[0]);
    const lastCoord = coordinateToKey(sublist[sublist.length - 1]);
    return coordCount.get(firstCoord) === 1 || coordCount.get(lastCoord) === 1;
  });

  // If no clear endpoint found (e.g., circular routes or complex junctions), use first sublist
  if (startingSublistIndex === -1) {
    log("[mergeLinearChain] No clear endpoint found, using first sublist as starting point");
    startingSublistIndex = 0;
  }

  // Extract the starting sublist
  const mergedChain = [...remainingSublists[startingSublistIndex]];
  remainingSublists.splice(startingSublistIndex, 1);

  // Step 2.1: Orient the starting sublist correctly if we have a clear endpoint
  const firstCoord = coordinateToKey(mergedChain[0]);
  const lastCoord = coordinateToKey(mergedChain[mergedChain.length - 1]);

  // If the last coordinate appears only once, it should be at the end
  // If the first coordinate appears only once, it should be at the start (don't reverse)
  if (coordCount.get(lastCoord) === 1 && coordCount.get(firstCoord) !== 1) {
    // Last coord is endpoint, first coord is not -> need to reverse
    mergedChain.reverse();
  }

  // Step 3: Build the chain incrementally
  while (remainingSublists.length > 0) {
    const lastCoordInChain = mergedChain[mergedChain.length - 1];
    const lastCoordKey = coordinateToKey(lastCoordInChain);

    // Find the next sublist that connects to the current chain. Only the
    // sublists' own endpoints count as connections — that is how the pathfinder
    // graph is built (parts are adjacent when they share a first/last
    // coordinate). Matching a coordinate in the *middle* of a sublist would
    // pass the check but then splice in a segment that doesn't start at the
    // chain's tail, silently producing a geometry with a jump in it.
    const nextIndex = remainingSublists.findIndex(
      (sublist) =>
        coordinateToKey(sublist[0]) === lastCoordKey ||
        coordinateToKey(sublist[sublist.length - 1]) === lastCoordKey,
    );

    if (nextIndex === -1) {
      throw new Error("Chain is broken; no connecting sublist found.");
    }

    // Orient the next sublist so its connecting endpoint comes first
    const nextSublist = [...remainingSublists[nextIndex]];
    if (coordinateToKey(nextSublist[0]) !== lastCoordKey) {
      nextSublist.reverse();
    }

    // Add the non-overlapping part of the sublist to the chain
    mergedChain.push(...nextSublist.slice(1));

    // Remove the processed sublist
    remainingSublists.splice(nextIndex, 1);
  }

  return mergedChain;
}

/**
 * Converts an array of coordinates to WKT LINESTRING format
 * @param coordinates - Array of [lon, lat] coordinates
 * @returns WKT LINESTRING string
 */
export function coordinatesToWKT(coordinates: Coord[]): string {
  return `LINESTRING(${coordinates.map((coord) => `${coord[0]} ${coord[1]}`).join(",")})`;
}
