/**
 * TEMPORARY, for the switch from the part-count search to the distance search
 * that keeps off other routes' track (`RailwayPathFinder`). Each time the search
 * changes, `npm run flagPathfinderChanges` marks every route and
 * scenic line whose path the new search moves invalid under this reason, so the
 * admin re-picks each by hand rather than a recalculation saving it unseen; the
 * admin lists' "Recalculated" chip is the worklist. Remove this, the chip and
 * the script once the worklist is empty (TODO.md).
 */
export const PATHFINDER_CHANGE_ERROR = "New pathfinder";

/** Whether an invalid line's error is the new search's flag. */
export function isPathfinderChange(errorMessage: string | null | undefined): boolean {
  return errorMessage?.startsWith(PATHFINDER_CHANGE_ERROR) ?? false;
}
