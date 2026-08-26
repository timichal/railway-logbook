import type {
  FillLayerSpecification,
  LayerSpecification,
  StyleSpecification,
} from "@maplibre/maplibre-gl-style-spec";

/**
 * The basemap, ported from `src/lib/map/basemap.ts`.
 *
 * ## Why this file exists at all
 *
 * `MOBILE_APP_PLAN.md` originally claimed the Latin-label rewrite "does not need
 * to [carry over]: MapLibre Native exposes label localization on the MapView
 * directly". That is true of rnmapbox (`localizeLabels`), but **not** of
 * `@maplibre/maplibre-react-native` v11 — its `<Map>` has no such prop. So the
 * rewrite does carry over, and the way it carries over is this: `mapStyle`
 * accepts `string | StyleSpecification`, so the style is fetched, processed with
 * the same three functions the web app uses, and handed over as an object.
 *
 * Which makes this a second thing the spike measures: whether shipping a ~110
 * layer style object across the RN bridge is workable, and what it costs.
 *
 * The types are the spec's own, exactly as on the web — `LayerSpecification`
 * here is the same declaration `maplibregl.LayerSpecification` resolves to.
 */

/** What we hand to `<Map mapStyle>`; the same `Pick` the web app uses, plus `version`. */
export type BasemapStyle = Pick<
  StyleSpecification,
  "version" | "sources" | "layers" | "glyphs" | "sprite"
>;

export const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const STYLE_FETCH_TIMEOUT_MS = 10000;

/** `OPACITIES.basemapFade` from style.ts. */
const OPACITY_BASEMAP_FADE = 0.25;

/** `LATIN_LABEL_EXPRESSION` from basemap.ts. */
const LATIN_LABEL_EXPRESSION = [
  "coalesce",
  ["get", "name_en"],
  ["get", "name:latin"],
  ["get", "name"],
];

/** `POI_LAYER_IDS` from basemap.ts. */
const POI_LAYER_IDS = new Set(["poi_r1", "poi_r7", "poi_r20", "poi_transit"]);

const BUILDING_FILL_COLOR = "hsl(35,8%,85%)";
const BUILDING_OUTLINE_COLOR = "hsl(35,6%,79%)";

export function dropPoiLayers(layers: LayerSpecification[]): LayerSpecification[] {
  return layers.filter((layer) => !POI_LAYER_IDS.has(layer.id));
}

/** `flattenBuildings` — keyed on the layer type, not on `building-3d` by name. */
export function flattenBuildings(layers: LayerSpecification[]): LayerSpecification[] {
  return layers.map((layer) => {
    if (layer.type !== "fill-extrusion") return layer;
    const flattened: FillLayerSpecification = {
      id: layer.id,
      type: "fill",
      source: layer.source,
      paint: {
        "fill-color": layer.paint?.["fill-extrusion-color"] ?? BUILDING_FILL_COLOR,
        "fill-outline-color": BUILDING_OUTLINE_COLOR,
      },
    };
    if (layer["source-layer"] !== undefined) flattened["source-layer"] = layer["source-layer"];
    if (layer.minzoom !== undefined) flattened.minzoom = layer.minzoom;
    if (layer.maxzoom !== undefined) flattened.maxzoom = layer.maxzoom;
    if (layer.filter !== undefined) flattened.filter = layer.filter;
    return flattened;
  });
}

/** `latinizeLabels` — the test is what the layer *reads*, not what it is called. */
export function latinizeLabels(layers: LayerSpecification[]): LayerSpecification[] {
  return layers.map((layer) => {
    if (layer.type !== "symbol") return layer;
    const textField = layer.layout?.["text-field"];
    if (!textField || !JSON.stringify(textField).includes("name")) return layer;
    return {
      ...layer,
      layout: {
        ...layer.layout,
        "text-field": LATIN_LABEL_EXPRESSION,
      },
    } as LayerSpecification;
  });
}

/**
 * `createBasemapFadeLayer`. A `background` layer needs no source and paints the
 * whole viewport, so one of these above the basemap and below our layers fades
 * the lot in a single step — the vector equivalent of `raster-opacity: 0.6`.
 *
 * The spike appends it as the style's last layer and adds the railway layers as
 * `<Map>` children, which land on top. That ordering is the thing to verify.
 */
export function createBasemapFadeLayer(): LayerSpecification {
  return {
    id: "basemap_fade",
    type: "background",
    paint: {
      "background-color": "#ffffff",
      "background-opacity": OPACITY_BASEMAP_FADE,
    },
  };
}

export interface LoadResult {
  style: BasemapStyle;
  /** How long the fetch plus processing took, in ms — a Phase 0 measurement. */
  elapsedMs: number;
  layerCount: number;
}

/**
 * Fetch the style and process it exactly as the web app does.
 *
 * `AbortSignal.timeout` (which the web app uses) is not reliably present in
 * Hermes, so the timeout is an AbortController plus a timer.
 */
export async function loadBasemapStyle(fade: boolean): Promise<LoadResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STYLE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(BASEMAP_STYLE_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`${BASEMAP_STYLE_URL} responded ${response.status}`);
    const raw = (await response.json()) as StyleSpecification;
    if (!raw.sources || !raw.layers) throw new Error("style returned no sources or layers");

    const layers = latinizeLabels(flattenBuildings(dropPoiLayers(raw.layers)));
    if (fade) layers.push(createBasemapFadeLayer());

    return {
      style: {
        version: 8,
        sources: raw.sources,
        layers,
        glyphs: raw.glyphs,
        sprite: raw.sprite,
      },
      elapsedMs: Date.now() - startedAt,
      layerCount: layers.length,
    };
  } finally {
    clearTimeout(timer);
  }
}
