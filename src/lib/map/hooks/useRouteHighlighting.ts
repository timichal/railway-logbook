import type * as maplibregl from "maplibre-gl";
import { useEffect } from "react";
import { COLORS } from "@/lib/map";
import {
  createHighlightCasingLayer,
  createHighlightLayer,
  createPartialHighlightLayer,
  highlightCasingLayerId,
  highlightFilter,
  highlightLayerId,
  highlightVariants,
  partialHighlightData,
  partialHighlightLayerId,
  partialHighlightSourceId,
  wholeRouteIds,
} from "@/lib/map/highlightLayers";
import type { HighlightKind, PartialRouteGeometry, SelectedRoute } from "@/lib/types";

/**
 * The web app's half of the highlight overlays: add, update and remove the layers
 * that `highlightLayers.ts` describes.
 *
 * What a highlight *looks like* — which sublayers, which widths, dashes and
 * casings — is shared with the native app and lives in that module. This file is
 * only the mechanism: a live `maplibregl.Map` mutated in place, where the native
 * app mounts and unmounts the same specs as children.
 */

export { HIGHLIGHT_LAYER_IDS } from "@/lib/map/highlightLayers";

/**
 * Add/update/remove the overlay sublayers for one highlight set.
 *
 * A casing, where the variant asks for one, is added *before* its own layer so it
 * ends up underneath (`addLayer` appends).
 */
function syncHighlightOverlay(
  m: maplibregl.Map,
  baseId: string,
  ids: number[],
  color: string,
): void {
  for (const v of highlightVariants()) {
    const layerId = highlightLayerId(baseId, v);
    const casingId = highlightCasingLayerId(baseId, v);

    if (ids.length === 0) {
      // Casing first: removing the dash layer first would leave it briefly alone
      if (m.getLayer(casingId)) m.removeLayer(casingId);
      if (m.getLayer(layerId)) m.removeLayer(layerId);
      continue;
    }

    const filter = highlightFilter(ids, v.usageType) as maplibregl.FilterSpecification;

    if (m.getLayer(layerId)) {
      if (m.getLayer(casingId)) {
        m.setPaintProperty(casingId, "line-color", color);
        m.setFilter(casingId, filter);
      }
      m.setPaintProperty(layerId, "line-color", color);
      m.setFilter(layerId, filter);
      continue;
    }

    if (v.casing) {
      m.addLayer(
        createHighlightCasingLayer(baseId, v, color, ids) as maplibregl.LayerSpecification,
      );
    }
    m.addLayer(createHighlightLayer(baseId, v, color, ids) as maplibregl.LayerSpecification);
  }
}

/**
 * Draw the covered stretch of partially-travelled routes from its own geometry —
 * see `createPartialHighlightLayer` for why a stretch cannot come from the tile.
 */
function syncPartialOverlay(
  m: maplibregl.Map,
  baseId: string,
  partials: PartialRouteGeometry[],
  color: string,
): void {
  const sourceId = partialHighlightSourceId(baseId);
  const layerId = partialHighlightLayerId(baseId);

  if (partials.length === 0) {
    if (m.getLayer(layerId)) m.removeLayer(layerId);
    if (m.getSource(sourceId)) m.removeSource(sourceId);
    return;
  }

  const data = partialHighlightData(partials) as GeoJSON.FeatureCollection;

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

  m.addLayer(createPartialHighlightLayer(baseId, color) as maplibregl.LayerSpecification);
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
