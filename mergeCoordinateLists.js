// shamelessly subcontracted to chatgpt

export default function mergeLinearChain(sublists) {
  let startingSublistIndex = sublists.findIndex(list => {
    return !sublists.some(otherList => {
      return list !== otherList &&
        list[0][0] === otherList[otherList.length - 1][0] &&
        list[0][1] === otherList[otherList.length - 1][1];
    });
  });

  if (startingSublistIndex === -1) {
    throw new Error("No valid starting sublist found.");
  }

  // Extract the starting sublist
  let mergedChain = [...sublists[startingSublistIndex]];
  sublists.splice(startingSublistIndex, 1); // Remove the starting sublist

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
