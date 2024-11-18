// shamelessly outsourced to ChatGPT

export default function mergeCoordinateLists(lists) {
  let merged = [];  // This will hold the final merged list
  let remainingLists = [...lists];  // Clone the input lists

  // Find the first list that doesn't match the end of any other list
  let firstListIndex = remainingLists.findIndex(list => {
    return !remainingLists.some(otherList => {
      return list !== otherList &&
        list[0][0] === otherList[otherList.length - 1][0] &&
        list[0][1] === otherList[otherList.length - 1][1];
    });
  });

  // Start with the first list
  merged = remainingLists.splice(firstListIndex, 1)[0];

  // Merge the rest of the lists
  while (remainingLists.length > 0) {
    for (let i = 0; i < remainingLists.length; i++) {
      const lastCoord = merged[merged.length - 1];
      const firstCoord = remainingLists[i][0];

      // If the last coordinate of the merged list matches the first of the current list
      if (lastCoord[0] === firstCoord[0] && lastCoord[1] === firstCoord[1]) {
        // Append the rest of the current list to the merged list, excluding the matching coordinate
        merged = merged.concat(remainingLists[i].slice(1));
        // Remove the current list from remaining lists
        remainingLists.splice(i, 1);
        break;
      }
    }
  }

  return merged;
}
