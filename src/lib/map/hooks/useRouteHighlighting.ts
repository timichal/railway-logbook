import type maplibregl from "maplibre-gl";
import { useEffect } from "react";
import { COLORS, DASHES, OPACITIES, WIDTHS } from "@/lib/map";
import type { SelectedRoute } from "@/lib/types";
import {
  getUserRouteHeritageWidthExpression,
  getUserRouteWidthExpression,
} from "../utils/userRouteStyling";

/**
 * 'planner'  — pathfinder result between two stations (gold)
 * 'view'     — viewing journeys/trips in My Trips (orange, matches admin selection)
 */
export type HighlightKind = "planner" | "view";

export type HighlightRoutesFn = (routeIds: number[], kind?: HighlightKind) => void;

/**
 * Each highlight set is drawn as three overlay sublayers — one per usage type —
 * so the highlight matches the route's own style instead of painting a solid bar
 * over it: Regular gets a fat solid line, Heritage a dotted line, Special a
 * dashed line. The dotted/dashed overlays reuse the exact width + dash of the
 * base route layers (dasharray is in line-width multiples, so matching the width
 * makes the highlight dots/dashes line up with the route's). The two base ids
 * are `highlighted_routes` (planner/view) and `selected_routes_highlight`
 * (Route Logger selection).
 */
const HIGHLIGHT_BASE_IDS = ["highlighted_routes", "selected_routes_highlight"] as const;

type HighlightVariant = {
  suffix: "regular" | "heritage" | "special";
  usageType: number;
  width: maplibregl.ExpressionSpecification | number;
  dash?: number[];
  roundCap?: boolean;
};

function highlightVariants(): HighlightVariant[] {
  return [
    // Regular: fat solid line (solid, so no dash alignment to worry about).
    { suffix: "regular", usageType: 0, width: WIDTHS.selectedRoute },
    // Heritage: dotted, matching the base heritage layer's width + dash so dots align.
    {
      suffix: "heritage",
      usageType: 1,
      width: getUserRouteHeritageWidthExpression(),
      dash: [...DASHES.heritage],
      roundCap: true,
    },
    // Special: dashed, matching the base special layer's width + dash.
    {
      suffix: "special",
      usageType: 2,
      width: getUserRouteWidthExpression(),
      dash: [...DASHES.special],
    },
  ];
}

/** All overlay layer ids managed here — used elsewhere to remove them before a
 * source rebuild and to include them in route hit-testing. */
export const HIGHLIGHT_LAYER_IDS = HIGHLIGHT_BASE_IDS.flatMap((base) =>
  highlightVariants().map((v) => `${base}_${v.suffix}`),
);

/**
 * Add/update/remove the three overlay sublayers for one highlight set.
 */
function syncHighlightOverlay(
  m: maplibregl.Map,
  baseId: string,
  ids: number[],
  color: string,
): void {
  for (const v of highlightVariants()) {
    const layerId = `${baseId}_${v.suffix}`;

    if (ids.length === 0) {
      if (m.getLayer(layerId)) m.removeLayer(layerId);
      continue;
    }

    const filter: maplibregl.FilterSpecification = [
      "all",
      ["in", ["id"], ["literal", ids]],
      ["==", ["get", "usage_type"], v.usageType],
    ];

    if (m.getLayer(layerId)) {
      m.setPaintProperty(layerId, "line-color", color);
      m.setFilter(layerId, filter);
      continue;
    }

    m.addLayer({
      id: layerId,
      type: "line",
      source: "railway_routes",
      "source-layer": "railway_routes",
      layout: v.roundCap ? { "line-cap": "round" } : {},
      paint: {
        "line-color": color,
        "line-width": v.width,
        "line-opacity": OPACITIES.highlight,
        ...(v.dash ? { "line-dasharray": v.dash } : {}),
      },
      filter,
    });
  }
}

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: tileRefreshKey is an intentional trigger — bumping it re-applies highlights after the railway_routes source/layer is recreated.
  useEffect(() => {
    const m = map.current;
    if (!m?.getLayer("railway_routes")) return;
    syncHighlightOverlay(m, "highlighted_routes", highlightedRoutes, highlightColor);
  }, [map, highlightedRoutes, highlightColor, tileRefreshKey]);

  // Route Logger selection highlights — match the admin map's selected-route style
  // (orange #ff6b35, full opacity), but per usage type so dotted/dashed routes stay so.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tileRefreshKey is an intentional trigger — bumping it re-applies the selection highlight after the railway_routes source/layer is recreated.
  useEffect(() => {
    const m = map.current;
    if (!m?.getLayer("railway_routes")) return;
    const selectedTrackIds = selectedRoutes.map((r) => parseInt(r.track_id, 10));
    syncHighlightOverlay(m, "selected_routes_highlight", selectedTrackIds, COLORS.highlight.view);
  }, [map, selectedRoutes, tileRefreshKey]);
}
