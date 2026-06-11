import type maplibregl from "maplibre-gl";
import { useEffect } from "react";
import { COLORS, OPACITIES, WIDTHS } from "@/lib/map";
import type { SelectedRoute } from "@/lib/types";

/**
 * 'planner'  — pathfinder result between two stations (gold)
 * 'view'     — viewing journeys/trips in My Trips (orange, matches admin selection)
 */
export type HighlightKind = "planner" | "view";

export type HighlightRoutesFn = (routeIds: number[], kind?: HighlightKind) => void;

/**
 * Manages highlight overlay layers on the user map:
 * - Gold highlights from Journey Planner pathfinding
 * - Orange highlights from Route Logger selection and My Trips views
 */
export function useRouteHighlighting(
  map: React.MutableRefObject<maplibregl.Map | null>,
  highlightedRoutes: number[],
  highlightKind: HighlightKind,
  selectedRoutes: SelectedRoute[],
  /** Bumped when the railway_routes source/layer is recreated so highlights re-apply. */
  tileRefreshKey?: number,
) {
  // Journey planner uses gold; My Trips view uses the same orange as
  // the admin-map selected-route style.
  const highlightColor =
    highlightKind === "planner" ? COLORS.highlight.planner : COLORS.highlight.view;

  useEffect(() => {
    if (!map.current?.getLayer("railway_routes")) return;

    if (highlightedRoutes.length > 0) {
      if (!map.current.getLayer("highlighted_routes")) {
        map.current.addLayer({
          id: "highlighted_routes",
          type: "line",
          source: "railway_routes",
          "source-layer": "railway_routes",
          paint: {
            "line-color": highlightColor,
            "line-width": WIDTHS.selectedRoute,
            "line-opacity": OPACITIES.highlight,
          },
          filter: ["in", ["id"], ["literal", highlightedRoutes]],
        });
      } else {
        map.current.setPaintProperty("highlighted_routes", "line-color", highlightColor);
        map.current.setFilter("highlighted_routes", ["in", ["id"], ["literal", highlightedRoutes]]);
      }
    } else {
      if (map.current.getLayer("highlighted_routes")) {
        map.current.removeLayer("highlighted_routes");
      }
    }
  }, [map, highlightedRoutes, highlightColor, tileRefreshKey]);

  // Route Logger selection highlights — match the admin map's selected-route style
  // (orange #ff6b35, constant 5px, full opacity).
  useEffect(() => {
    if (!map.current?.getLayer("railway_routes")) return;

    const selectedTrackIds = selectedRoutes.map((r) => parseInt(r.track_id, 10));

    if (selectedTrackIds.length > 0) {
      if (!map.current.getLayer("selected_routes_highlight")) {
        map.current.addLayer({
          id: "selected_routes_highlight",
          type: "line",
          source: "railway_routes",
          "source-layer": "railway_routes",
          paint: {
            "line-color": COLORS.highlight.view,
            "line-width": WIDTHS.selectedRoute,
            "line-opacity": OPACITIES.highlight,
          },
          filter: ["in", ["id"], ["literal", selectedTrackIds]],
        });
      } else {
        map.current.setFilter("selected_routes_highlight", [
          "in",
          ["id"],
          ["literal", selectedTrackIds],
        ]);
      }
    } else {
      if (map.current.getLayer("selected_routes_highlight")) {
        map.current.removeLayer("selected_routes_highlight");
      }
    }
  }, [map, selectedRoutes, tileRefreshKey]);
}
