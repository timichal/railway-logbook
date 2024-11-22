// shamelessly outsourced to chatgpt

type Coord = [x: number, y: number];

export default function mergeLinearChain(sublists: Coord[][]) {
  // Step 1: Create a map of coordinate frequencies
  const coordCount = new Map();
  sublists.flat().forEach(([x, y]) => {
    const key = `${x},${y}`;
    coordCount.set(key, (coordCount.get(key) || 0) + 1);
  });

  // Step 2: Find the starting sublist
  let startingSublistIndex = sublists.findIndex(sublist => {
    const firstCoord = `${sublist[0][0]},${sublist[0][1]}`;
    const lastCoord = `${sublist[sublist.length - 1][0]},${sublist[sublist.length - 1][1]}`;
    return coordCount.get(firstCoord) === 1 || coordCount.get(lastCoord) === 1;
  });

  if (startingSublistIndex === -1) {
    throw new Error("No valid starting sublist found.");
  }

  // Extract the starting sublist
  let mergedChain = [...sublists[startingSublistIndex]];
  sublists.splice(startingSublistIndex, 1); // Remove the starting sublist

  // Step 2.1: Ensure the starting sublist is oriented correctly
  const lastCoord = `${mergedChain[mergedChain.length - 1][0]},${mergedChain[mergedChain.length - 1][1]}`;
  if (coordCount.get(lastCoord) === 1) {
    mergedChain.reverse(); // Reverse if the starting point is at the "end"
  }

  // Step 3: Build the chain incrementally
  while (sublists.length > 0) {
    const lastCoord = mergedChain[mergedChain.length - 1];

    // Find the next sublist that connects to the current chain
    const nextIndex = sublists.findIndex(sublist =>
      sublist.some(([x, y]) => x === lastCoord[0] && y === lastCoord[1])
    );

    if (nextIndex === -1) {
      throw new Error("Chain is broken; no connecting sublist found.");
    }

    // Extract the next sublist and reverse it if necessary
    let nextSublist = sublists[nextIndex];
    const overlapIndex = nextSublist.findIndex(([x, y]) => x === lastCoord[0] && y === lastCoord[1]);

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
