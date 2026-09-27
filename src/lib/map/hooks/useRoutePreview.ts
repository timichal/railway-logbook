import { useEffect, useEffectEvent, useState } from "react";
import { unwrap } from "@/lib/actionResult";
import { findRailwayPathFromCoordinates } from "@/lib/adminMapActions";

/** The path found between the two picked points: what the admin map draws and a save stores. */
export interface PathPreview {
  partIds: string[];
  coordinates: [number, number][];
  startCoordinate: [number, number];
  endCoordinate: [number, number];
  hasBacktracking?: boolean;
}

/**
 * The admin's route preview: searched for as soon as both points are picked, and
 * shown only while they still are.
 *
 * Derived from the points rather than kept beside them, because every way of
 * dropping a point (clearing it, a region switch, selecting a route, a save)
 * has to drop the preview too, and a preview left behind was a path on the map
 * that the form would still save. For the same reason a search whose points
 * changed while it ran is discarded — its answer is for points no longer picked.
 * Points are compared by identity: each click makes a new array.
 *
 * Lives with the page, not the create tab, which unmounts with the mobile drawer.
 */
export function useRoutePreview(
  start: [number, number] | null,
  end: [number, number] | null,
  onError: (message: string) => void,
): PathPreview | null {
  const [found, setFound] = useState<PathPreview | null>(null);
  const reportError = useEffectEvent(onError);

  useEffect(() => {
    // Dropped rather than only hidden: with a point gone, nothing can make it
    // current again, and the coordinates run to thousands of points.
    if (!start || !end) {
      setFound(null);
      return;
    }
    let cancelled = false;

    findRailwayPathFromCoordinates(start, end)
      .then(unwrap)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          reportError(
            "No path found between the selected coordinates within 222km. Make sure both points are on connected railway parts.",
          );
          return;
        }
        setFound({
          partIds: result.partIds,
          coordinates: result.coordinates,
          startCoordinate: start,
          endCoordinate: end,
          hasBacktracking: result.hasBacktracking,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Preview: path search failed:", error);
        reportError(
          `Error finding a path: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [start, end]);

  return found && found.startCoordinate === start && found.endCoordinate === end ? found : null;
}
