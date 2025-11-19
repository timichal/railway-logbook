/**
 * Shared coordinate utilities for route geometry processing
 */

export type Coord = [number, number];

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
 * @param sublists - Array of coordinate arrays to merge
 * @returns A single merged coordinate array in the correct order
 * @throws Error if the chain is broken
 */
export function mergeLinearChain(sublists: Coord[][]): Coord[] {
  if (sublists.length === 0) return [];
  if (sublists.length === 1) return sublists[0];

  // Make a copy to avoid mutating the original
  const remainingSublists = sublists.map(s => [...s]);

  // Step 1: Create a map of coordinate frequencies
  const coordCount = new Map<string, number>();
  remainingSublists.forEach(sublist => {
    const firstKey = `${sublist[0][0]},${sublist[0][1]}`;
    const lastKey = `${sublist[sublist.length - 1][0]},${sublist[sublist.length - 1][1]}`;
    coordCount.set(firstKey, (coordCount.get(firstKey) || 0) + 1);
    coordCount.set(lastKey, (coordCount.get(lastKey) || 0) + 1);
  });

  // Step 2: Find the starting sublist (prefer one with an endpoint that appears only once)
  let startingSublistIndex = remainingSublists.findIndex(sublist => {
    const firstCoord = `${sublist[0][0]},${sublist[0][1]}`;
    const lastCoord = `${sublist[sublist.length - 1][0]},${sublist[sublist.length - 1][1]}`;
    return coordCount.get(firstCoord) === 1 || coordCount.get(lastCoord) === 1;
  });

  // If no clear endpoint found (e.g., circular routes or complex junctions), use first sublist
  if (startingSublistIndex === -1) {
    console.log('[mergeLinearChain] No clear endpoint found, using first sublist as starting point');
    startingSublistIndex = 0;
  }

  // Extract the starting sublist
  const mergedChain = [...remainingSublists[startingSublistIndex]];
  remainingSublists.splice(startingSublistIndex, 1);

  // Step 2.1: Orient the starting sublist correctly if we have a clear endpoint
  const firstCoord = `${mergedChain[0][0]},${mergedChain[0][1]}`;
  const lastCoord = `${mergedChain[mergedChain.length - 1][0]},${mergedChain[mergedChain.length - 1][1]}`;

  // If the last coordinate appears only once, it should be at the end
  // If the first coordinate appears only once, it should be at the start (don't reverse)
  if (coordCount.get(lastCoord) === 1 && coordCount.get(firstCoord) !== 1) {
    // Last coord is endpoint, first coord is not -> need to reverse
    mergedChain.reverse();
  }

  // Step 3: Build the chain incrementally
  while (remainingSublists.length > 0) {
    const lastCoordInChain = mergedChain[mergedChain.length - 1];

    // Find the next sublist that connects to the current chain
    const nextIndex = remainingSublists.findIndex(sublist =>
      sublist.some(([x, y]) => x === lastCoordInChain[0] && y === lastCoordInChain[1])
    );

    if (nextIndex === -1) {
      throw new Error("Chain is broken; no connecting sublist found.");
    }

    // Extract the next sublist and reverse it if necessary
    const nextSublist = [...remainingSublists[nextIndex]];
    const overlapIndex = nextSublist.findIndex(([x, y]) => x === lastCoordInChain[0] && y === lastCoordInChain[1]);

    if (overlapIndex !== 0) {
      nextSublist.reverse(); // Reverse if the overlap is not at the start
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
  return `LINESTRING(${coordinates.map(coord => `${coord[0]} ${coord[1]}`).join(',')})`;
}
