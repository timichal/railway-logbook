import type * as maplibregl from "maplibre-gl";
import { OPACITIES } from "./style";

/**
 * The basemap under the railway data.
 *
 * OpenFreeMap serves the OpenMapTiles schema as vector tiles, free and without
 * an API key. Vector rather than raster for one reason: label language. Raster
 * basemaps bake the labels into the image at whatever OSM's local `name` says,
 * so the Japan region came out in kanji with no way to ask for anything else.
 * Here the label is a style property, and `latinizeLabels` sets it.
 *
 * Attribution (OpenFreeMap / OpenMapTiles / OSM) is declared by the TileJSON at
 * the source `url`, so MapLibre picks it up on its own - do not restate it here.
 */
export const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** Raster fallback, used when the vector style cannot be fetched. */
export const OSM_TILES_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** How long to wait for the style before falling back to the raster basemap. */
const STYLE_FETCH_TIMEOUT_MS = 6000;

/**
 * The parts of a fetched style we hand to MapLibre. `glyphs` and `sprite` come
 * along because the basemap's own label and POI layers need them; our layers
 * carry no text or icons.
 */
export type BasemapStyle = Pick<
  maplibregl.StyleSpecification,
  "sources" | "layers" | "glyphs" | "sprite"
>;

/**
 * Latin-first label text. `name:latin` is OpenMapTiles' latin-script name
 * (transliterated where OSM has no latin name), `name_en` a second chance, and
 * plain `name` the last resort - so a place with no latin name at all still gets
 * a label rather than a blank.
 */
const LATIN_LABEL_EXPRESSION = [
  "coalesce",
  ["get", "name:latin"],
  ["get", "name_en"],
  ["get", "name"],
] as maplibregl.ExpressionSpecification;

/**
 * The basemap's POI layers, dropped on load.
 *
 * These are the four layers over the `poi` source-layer - cafes, ATMs, shops,
 * bollards, transit pins - and they are clutter on a railway map: they carry
 * nothing to click, and their circles compete with the station circles, which do.
 * Dropping them also removes the whole class of missing-icon warning at source,
 * since they are the only layers that build an `icon-image` name out of an OSM
 * tag value the sprite was never guaranteed to cover.
 */
const POI_LAYER_IDS = new Set(["poi_r1", "poi_r7", "poi_r20", "poi_transit"]);

export function dropPoiLayers(
  layers: maplibregl.LayerSpecification[],
): maplibregl.LayerSpecification[] {
  return layers.filter((layer) => !POI_LAYER_IDS.has(layer.id));
}

/**
 * Rewrite every name-based label in the style to Latin script.
 *
 * The stock style prints `name:latin` and `name:nonlatin` stacked, which is how
 * Tokyo arrived as "Tōkyō / 東京". Layers whose text is a route number rather
 * than a name (`highway-shield-*`, `road_shield_us`, the one-way arrows) are
 * left alone - the test is what the layer reads, not what it is called, since
 * `highway-name-major` draws a name and `highway-shield-non-us` does not.
 */
export function latinizeLabels(
  layers: maplibregl.LayerSpecification[],
): maplibregl.LayerSpecification[] {
  return layers.map((layer) => {
    if (layer.type !== "symbol") return layer;
    const textField = layer.layout?.["text-field"];
    if (!textField || !JSON.stringify(textField).includes("name")) return layer;
    return {
      ...layer,
      layout: { ...layer.layout, "text-field": LATIN_LABEL_EXPRESSION },
    };
  });
}

/**
 * Washes the basemap out so the railway lines read as the subject.
 *
 * This replaces the `raster-opacity: 0.6` the raster basemap was drawn at: a
 * vector basemap is many layers, and fading each one is neither possible in one
 * property nor the same thing. A `background` layer needs no source and paints
 * the whole viewport, so one of them placed above the basemap and below our
 * layers fades the lot in a single step.
 */
export function createBasemapFadeLayer(): maplibregl.BackgroundLayerSpecification {
  return {
    id: "basemap_fade",
    type: "background",
    paint: {
      "background-color": "#ffffff",
      "background-opacity": OPACITIES.basemapFade,
    },
  };
}

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
 */
export function resolveMissingBasemapIcons(map: maplibregl.Map): void {
  map.setMissingStyleImageResolver((id) => {
    if (map.hasImage(id)) return;
    map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
}

async function fetchBasemapStyle(): Promise<BasemapStyle> {
  const response = await fetch(BASEMAP_STYLE_URL, {
    signal: AbortSignal.timeout(STYLE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${BASEMAP_STYLE_URL} responded ${response.status}`);
  }
  const style = (await response.json()) as maplibregl.StyleSpecification;
  if (!style.sources || !style.layers) {
    throw new Error(`${BASEMAP_STYLE_URL} returned no sources or layers`);
  }
  return {
    sources: style.sources,
    layers: latinizeLabels(dropPoiLayers(style.layers)),
    glyphs: style.glyphs,
    sprite: style.sprite,
  };
}

let pendingStyle: Promise<BasemapStyle | null> | null = null;

/**
 * The style, fetched once per page load and shared - both maps mount it, and a
 * region switch rebuilds the map from scratch.
 *
 * Resolves `null` rather than rejecting when the style is unreachable: the
 * caller then builds the raster basemap instead, because a railway map with a
 * plain OSM background is still usable and one with no background at all is
 * not. A failure clears the memo, so the next map to mount tries again.
 */
export function loadBasemapStyle(): Promise<BasemapStyle | null> {
  if (!pendingStyle) {
    pendingStyle = fetchBasemapStyle().catch((error) => {
      console.warn("Vector basemap unavailable, falling back to OSM raster tiles", error);
      pendingStyle = null;
      return null;
    });
  }
  return pendingStyle;
}

export function createOSMBackgroundLayer(): maplibregl.RasterLayerSpecification {
  return {
    id: "background",
    type: "raster",
    source: "osm",
    minzoom: 4,
    maxzoom: 19, // has to be higher than the map max zoom
    paint: {
      "raster-fade-duration": 0,
      "raster-saturation": 0,
      "raster-opacity": 0.6,
    },
  };
}

export function createOSMBackgroundSource(): maplibregl.RasterSourceSpecification {
  return {
    type: "raster",
    tiles: [OSM_TILES_URL],
    tileSize: 256,
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  };
}
