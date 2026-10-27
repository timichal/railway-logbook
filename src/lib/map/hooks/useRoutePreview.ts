import { useEffect, useEffectEvent, useState } from "react";
import { actionErrorMessage, unwrap } from "@/lib/actionResult";
import { findRailwayPathFromCoordinates } from "@/lib/adminMapActions";

/** The admin's two picked points: a new route's or scenic line's, or a geometry edit's re-pick. */
export interface CreateFormCoordinates {
  startingCoordinate: [number, number] | null;
  endingCoordinate: [number, number] | null;
}

/** The path found between the two picked points: what the admin map draws and a save stores. */
export interface PathPreview {
  partIds: string[];
  coordinates: [number, number][];
  startCoordinate: [number, number];
  endCoordinate: [number, number];
  hasBacktracking?: boolean;
  /** Measured by the server as a save measures it, so the two agree; null for a path too short to measure. */
  lengthKm: number | null;
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
 * `avoidBacktracking` searches as a scenic line's save does (`findAdminPath`); a
 * path found in the other mode is discarded the same way.
 *
 * Lives with the page, not the create tab, which unmounts with the mobile drawer.
 */
export function useRoutePreview(
  start: [number, number] | null,
  end: [number, number] | null,
  onError: (message: string) => void,
  { avoidBacktracking = false }: { avoidBacktracking?: boolean } = {},
): PathPreview | null {
  const [found, setFound] = useState<(PathPreview & { avoidBacktracking: boolean }) | null>(null);
  const reportError = useEffectEvent(onError);

  useEffect(() => {
    // Dropped rather than only hidden: with a point gone, nothing can make it
    // current again, and the coordinates run to thousands of points.
    if (!start || !end) {
      setFound(null);
      return;
    }
    let cancelled = false;

    findRailwayPathFromCoordinates(start, end, { avoidBacktracking })
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
          lengthKm: result.lengthKm,
          avoidBacktracking,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Preview: path search failed:", error);
        reportError(`Error finding a path: ${actionErrorMessage(error)}`);
      });

    return () => {
      cancelled = true;
    };
  }, [start, end, avoidBacktracking]);

  return found &&
    found.startCoordinate === start &&
    found.endCoordinate === end &&
    found.avoidBacktracking === avoidBacktracking
    ? found
    : null;
}
