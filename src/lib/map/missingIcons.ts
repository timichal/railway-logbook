import type * as maplibregl from "maplibre-gl";

/**
 * Stands a blank image in for basemap icons the sprite does not carry.
 *
 * `dropPoiLayers` removes the layers that produced this in bulk (`bollard`,
 * `atm`, `athletics` and every other OSM POI class absent from the sprite's 264
 * names). This stays as the backstop for the ones left: the route shields build
 * their icon name from tag values too (`concat(network, "_", ref_length)`), so an
 * unusual network still asks for a name upstream may not ship.
 *
 * A 1x1 transparent pixel is exactly what the map already looked like - MapLibre
 * draws the label and skips the icon when it cannot resolve one - so this changes
 * nothing but the console. MapLibre caches the image under the name it asked for,
 * so each missing name resolves once.
 *
 * It sits apart from `basemap.ts` because it is the one part of that file that
 * needs a live `maplibregl.Map` rather than a style object: the rest of the module
 * is shared with the native app, which has no `maplibre-gl` and resolves its
 * missing images inside the native SDK.
 */
export function resolveMissingBasemapIcons(map: maplibregl.Map): void {
  map.setMissingStyleImageResolver((id) => {
    if (map.hasImage(id)) return;
    map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
}
