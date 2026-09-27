import { useMemo } from "react";
import { calculateDistance } from "../utils/distance";
import type { PathPreview } from "./useRoutePreview";

/**
 * The length of the route preview, from its truncated coordinates — the ones the
 * saved length is computed from, so the two match. The selected route's length
 * is not worked out here: it comes with the detail the page already loads.
 */
export function useRouteLength(previewRoute: PathPreview | null | undefined): number | null {
  return useMemo(() => {
    if (!previewRoute?.coordinates || previewRoute.coordinates.length < 2) return null;

    let totalLength = 0;
    for (let i = 0; i < previewRoute.coordinates.length - 1; i++) {
      totalLength += calculateDistance(
        previewRoute.coordinates[i],
        previewRoute.coordinates[i + 1],
      );
    }
    return totalLength;
  }, [previewRoute]);
}
