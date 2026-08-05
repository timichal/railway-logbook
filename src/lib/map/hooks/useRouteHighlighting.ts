import type * as maplibregl from "maplibre-gl";
import { useEffect } from "react";
import { COLORS, DASHES, OPACITIES, WIDTHS } from "@/lib/map";
import type { HighlightKind, PartialRouteGeometry, SelectedRoute } from "@/lib/types";
import {
  getUserRouteHeritageWidthExpression,
  getUserRouteWidthExpression,
} from "../utils/userRouteStyling";

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
 * Draw the covered stretch of partially-travelled routes from its own geometry.
 *
 * The tile-filter overlays above can only light up whole routes, so a route
 * covered only in part — a journey plan joining it at a station between its
 * endpoints, or that same route sitting in the Route Logger selection — is
 * excluded from them and drawn here instead, in the same colour and width.
 *
 * Each highlight set gets its own source/layer pair off `baseId`, so the gold
 * planner stretch and the orange selection stretch don't overwrite each other.
 * The coordinates are the route's own vertices, unsimplified: anything less and
 * the overlay visibly cuts corners off the line underneath.
 */
function syncPartialOverlay(
  m: maplibregl.Map,
  baseId: string,
  partials: PartialRouteGeometry[],
  color: string,
): void {
  const sourceId = `${baseId}_partial`;
  const layerId = `${baseId}_partial_line`;

  if (partials.length === 0) {
    if (m.getLayer(layerId)) m.removeLayer(layerId);
    if (m.getSource(sourceId)) m.removeSource(sourceId);
    return;
  }

  const data: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: partials.map((p) => ({
      type: "Feature",
      id: p.track_id,
      properties: { track_id: p.track_id },
      geometry: { type: "LineString", coordinates: p.coordinates },
    })),
  };

  const source = m.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
  } else {
    m.addSource(sourceId, { type: "geojson", data });
  }

  if (m.getLayer(layerId)) {
    m.setPaintProperty(layerId, "line-color", color);
    // A tile refresh re-adds the route layers on top; keep the overlay above them
    m.moveLayer(layerId);
    return;
  }

  m.addLayer({
    id: layerId,
    type: "line",
    source: sourceId,
    layout: { "line-cap": "butt" },
    paint: {
      "line-color": color,
      "line-width": WIDTHS.selectedRoute,
      "line-opacity": OPACITIES.highlight,
    },
  });
}

/** The ids of a highlight set that are covered whole, i.e. not drawn as a stretch. */
function wholeRouteIds(ids: number[], partials: PartialRouteGeometry[]): number[] {
  const partialIds = new Set(partials.map((p) => p.track_id));
  return ids.filter((id) => !partialIds.has(id));
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
  /** Routes to highlight only along part of their length (see HighlightRoutesFn). */
  partialHighlights: PartialRouteGeometry[] = [],
) {
  // Journey planner uses gold; My Trips view uses the same orange as
  // the admin-map selected-route style.
  const highlightColor =
    highlightKind === "planner" ? COLORS.highlight.planner : COLORS.highlight.view;

  // biome-ignore lint/correctness/useExhaustiveDependencies: tileRefreshKey is an intentional trigger — bumping it re-applies highlights after the railway_routes source/layer is recreated.
  useEffect(() => {
    const m = map.current;
    if (!m?.getLayer("railway_routes")) return;
    // Partially-travelled routes are drawn from their own geometry, so keep them
    // out of the whole-route overlay
    const wholeIds = wholeRouteIds(highlightedRoutes, partialHighlights);
    syncHighlightOverlay(m, "highlighted_routes", wholeIds, highlightColor);
    syncPartialOverlay(m, "highlighted_routes", partialHighlights, highlightColor);
  }, [map, highlightedRoutes, highlightColor, partialHighlights, tileRefreshKey]);

  // Route Logger selection highlights — match the admin map's selected-route style
  // (orange #ff6b35, full opacity), but per usage type so dotted/dashed routes stay so.
  //
  // A route the Journey Planner only partly covers is highlighted along that
  // stretch alone: it is the stretch that will be logged, so lighting up the
  // whole route would claim more than the selection holds.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tileRefreshKey is an intentional trigger — bumping it re-applies the selection highlight after the railway_routes source/layer is recreated.
  useEffect(() => {
    const m = map.current;
    if (!m?.getLayer("railway_routes")) return;

    const selectedTrackIds = selectedRoutes.map((r) => r.track_id);
    const selectedPartials = selectedRoutes.flatMap((r) =>
      // Only while the route is still marked partial — unticking it claims the
      // whole route, and the highlight should say so
      r.partial && r.covered ? [r.covered] : [],
    );

    const wholeIds = wholeRouteIds(selectedTrackIds, selectedPartials);
    syncHighlightOverlay(m, "selected_routes_highlight", wholeIds, COLORS.highlight.view);
    syncPartialOverlay(m, "selected_routes_highlight", selectedPartials, COLORS.highlight.view);
  }, [map, selectedRoutes, tileRefreshKey]);
}
