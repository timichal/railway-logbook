import type * as maplibregl from "maplibre-gl";
import { REGULAR_ROUTE_LAYER_ID, ROUTE_CLICK_LAYER_ID } from "@/lib/shared/map/layers";

/** A route's wide click buffer included, so a route always wins over what lies under it. */
export const ROUTE_HIT_LAYERS = [ROUTE_CLICK_LAYER_ID, REGULAR_ROUTE_LAYER_ID];

/**
 * The rendered features under a point on those of `layers` the map has —
 * querying a layer that doesn't exist (yet, or in this map) is an error.
 */
export function featuresAt(
  map: maplibregl.Map,
  point: maplibregl.PointLike,
  layers: readonly string[],
): maplibregl.MapGeoJSONFeature[] {
  const present = layers.filter((id) => map.getLayer(id));
  return present.length > 0 ? map.queryRenderedFeatures(point, { layers: present }) : [];
}
