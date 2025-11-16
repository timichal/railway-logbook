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
 * 1. Find coordinate frequencies to identify endpoints (frequency = 1)
 * 2. Find the starting sublist (one that has an endpoint)
 * 3. Orient the starting sublist correctly
 * 4. Build the chain by finding connecting sublists and adding them in order
 *
 * @param sublists - Array of coordinate arrays to merge
 * @returns A single merged coordinate array in the correct order
 * @throws Error if no valid starting point is found or if the chain is broken
 */
export function mergeLinearChain(sublists: Coord[][]): Coord[] {
  if (sublists.length === 0) return [];
  if (sublists.length === 1) return sublists[0];

  // Step 1: Create a map of coordinate frequencies
  const coordCount = new Map<string, number>();
  sublists.flat().forEach(([x, y]) => {
    const key = `${x},${y}`;
    coordCount.set(key, (coordCount.get(key) || 0) + 1);
  });

  // Step 2: Find the starting sublist
  const startingSublistIndex = sublists.findIndex(sublist => {
    const firstCoord = `${sublist[0][0]},${sublist[0][1]}`;
    const lastCoord = `${sublist[sublist.length - 1][0]},${sublist[sublist.length - 1][1]}`;
    return coordCount.get(firstCoord) === 1 || coordCount.get(lastCoord) === 1;
  });

  if (startingSublistIndex === -1) {
    throw new Error("No valid starting sublist found.");
  }

  // Extract the starting sublist
  const mergedChain = [...sublists[startingSublistIndex]];
  sublists.splice(startingSublistIndex, 1); // Remove the starting sublist

  // Step 2.1: Ensure the starting sublist is oriented correctly
  const lastCoord = `${mergedChain[mergedChain.length - 1][0]},${mergedChain[mergedChain.length - 1][1]}`;
  if (coordCount.get(lastCoord) === 1) {
    mergedChain.reverse(); // Reverse if the starting point is at the "end"
  }

  // Step 3: Build the chain incrementally
  while (sublists.length > 0) {
    const lastCoordInChain = mergedChain[mergedChain.length - 1];

    // Find the next sublist that connects to the current chain
    const nextIndex = sublists.findIndex(sublist =>
      sublist.some(([x, y]) => x === lastCoordInChain[0] && y === lastCoordInChain[1])
    );

    if (nextIndex === -1) {
      throw new Error("Chain is broken; no connecting sublist found.");
    }

    // Extract the next sublist and reverse it if necessary
    const nextSublist = [...sublists[nextIndex]];
    const overlapIndex = nextSublist.findIndex(([x, y]) => x === lastCoordInChain[0] && y === lastCoordInChain[1]);

    if (overlapIndex !== 0) {
      nextSublist.reverse(); // Reverse if the overlap is not at the start
    }

    // Add the non-overlapping part of the sublist to the chain
    mergedChain.push(...nextSublist.slice(1));

    // Remove the processed sublist
    sublists.splice(nextIndex, 1);
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
