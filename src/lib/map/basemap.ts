import type * as maplibregl from "maplibre-gl";
import type { ResolvedTheme } from "@/lib/theme";
import { COLORS, OPACITIES, WIDTHS } from "./style";

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
export const BASEMAP_STYLE_URLS: Record<ResolvedTheme, string> = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  // OpenFreeMap serves a dark style beside liberty, so dark mode costs a URL rather
  // than a hand-recoloured style. It is also a much smaller one - 47 layers against
  // liberty's ~110, with no POI layers and no building extrusion - so `dropPoiLayers`
  // and `flattenBuildings` find nothing to do in it. They are applied all the same:
  // both key on what a layer *is*, not on the style it came from.
  dark: "https://tiles.openfreemap.org/styles/dark",
};

/** Raster fallback, used when the vector style cannot be fetched. */
export const OSM_TILES_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/**
 * Font glyphs for our own text layers (station names).
 *
 * The vector style declares this same endpoint, so on the normal path it comes
 * along with the style; the constant is what the raster fallback declares, since
 * a style with no `glyphs` renders no text at all.
 *
 * Any fontstack named in a `text-font` has to exist here, and the endpoint serves
 * exactly three - Noto Sans in Regular, Bold and Italic. There is no sleeker face
 * to pick from without hosting our own glyph PBFs. Both weights cover Latin
 * Extended-A, so the Czech and Polish names render.
 */
export const GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
export const BASEMAP_FONT = "Noto Sans Regular";
export const BASEMAP_FONT_BOLD = "Noto Sans Bold";

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

// try english name first, then latin, then whatever the local name is
const LATIN_LABEL_EXPRESSION = [
  "coalesce",
  ["get", "name_en"],
  ["get", "name:latin"],
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

/** Liberty's own building colours, kept for the flattened extrusion layer. */
const BUILDING_FILL_COLOR = "hsl(35,8%,85%)";
const BUILDING_OUTLINE_COLOR = "hsl(35,6%,79%)";

export function dropPoiLayers(
  layers: maplibregl.LayerSpecification[],
): maplibregl.LayerSpecification[] {
  return layers.filter((layer) => !POI_LAYER_IDS.has(layer.id));
}

/**
 * Flattens the basemap's extruded buildings back into footprints.
 *
 * Liberty draws buildings twice: a plain fill over z13-14, and `building-3d`,
 * a `fill-extrusion` from z14 up. The extrusion is the pseudo-3D block effect
 * that appears once you zoom into a town, and on a flat-drawn railway map it
 * reads as an artefact - the blocks lean with the viewport, throw the station
 * dots and route lines out of register with the ground they sit on, and paint
 * over them near the horizon.
 *
 * Rewritten rather than dropped: dropping it would leave nothing over z14, and
 * building footprints are the context that says which side of town a line runs
 * through. The extrusion colour carries over, plus the outline colour the z13-14
 * fill interpolates to at z14, so the two layers meet without a visible seam.
 *
 * Keyed on the layer *type*, not on `building-3d` by name - any extrusion in the
 * style is the same effect and gets the same treatment.
 */
export function flattenBuildings(
  layers: maplibregl.LayerSpecification[],
): maplibregl.LayerSpecification[] {
  return layers.map((layer) => {
    if (layer.type !== "fill-extrusion") return layer;
    const flattened: maplibregl.FillLayerSpecification = {
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

/**
 * Keeps park label points out of the park *outline* layer.
 *
 * OpenMapTiles' `park` source-layer carries a label **point** per park alongside
 * the park polygon, and liberty's `park_outline` is a `line` layer over that
 * source-layer with no filter at all - so every one of those points is handed to
 * a line bucket as a single-coordinate geometry. There are dozens per tile from
 * z6 up (269 on one z6 tile over the Netherlands).
 *
 * Nothing renders wrong - a point cannot be drawn as a line, so both renderers
 * discard it - but MapLibre Native says so out loud, once per process:
 * `Invalid geometry in line layer` (`line_bucket.cpp`, the branch that fires only
 * when the *source* geometry is short, not when de-duplication shortened it).
 * That is the warning the mobile spike reports against this style, and it is the
 * basemap's, not our route tile's - the route tiles decode as 100% LineString.
 * Filtering the points out silences it and saves the wasted bucket work on both
 * platforms.
 *
 * Applied only where the layer carries no filter of its own, which is the case
 * here: liberty's filters are in the legacy syntax, and a legacy filter cannot be
 * `["all", ...]`-combined with an expression one. If upstream ever gives this
 * layer a filter, it has taken its own view of which features it draws.
 */
export function filterPointsFromParkOutlines(
  layers: maplibregl.LayerSpecification[],
): maplibregl.LayerSpecification[] {
  return layers.map((layer) => {
    if (layer.type !== "line" || layer["source-layer"] !== "park") return layer;
    if (layer.filter !== undefined) return layer;
    return { ...layer, filter: ["!=", ["geometry-type"], "Point"] };
  });
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
export function createBasemapFadeLayer(
  theme: ResolvedTheme = "light",
): maplibregl.BackgroundLayerSpecification {
  const dark = theme === "dark";
  return {
    id: "basemap_fade",
    type: "background",
    paint: {
      // The wash is toward the ground the basemap is drawn on, so it fades rather
      // than tints: white over liberty, near-black over the dark style.
      "background-color": dark ? "#05070a" : "#ffffff",
      "background-opacity": dark ? OPACITIES.basemapFadeDark : OPACITIES.basemapFade,
    },
  };
}

/**
 * Country borders, redrawn by us *above* the fade layer.
 *
 * Zoomed out to a continent the map is a jumble of rail lines with nothing to
 * hang them on, and the borders that would give it a frame are exactly what the
 * fade takes away: both basemap styles draw admin_level 2 in a grey that is
 * already faint at full strength (liberty `hsl(248,1%,41%)`, dark
 * `hsl(0,0%,23%)`) and then loses another 25-40% of itself under the wash. Their
 * own layers are left where they are — the geometry is identical, so what shows
 * through underneath is a soft casing rather than a second line.
 *
 * It goes above the fade and below our data: the borders are the one piece of
 * basemap the routes are read *against*, so they earn full contrast, and the
 * routes still draw over them.
 *
 * **One layer serves both styles because the schema, not the style, is what it
 * reads.** Liberty and dark disagree on everything here — three boundary layers
 * each, no id in common, split by zoom in one and by admin level in the other —
 * but both are OpenMapTiles, so `openmaptiles`/`boundary` with `admin_level == 2`
 * is the same query against either. That is also why there is nothing for the
 * raster fallback: no vector source, no borders (`useMapLibre` adds this only
 * alongside a vector basemap).
 *
 * The filter drops **maritime** boundaries, which otherwise run the sea borders
 * out across open water and put more line on the map than they explain, and
 * anything with `claimed_by`, which draws a disputed frontier once per claimant
 * — two lines a few pixels apart saying the same thing at this zoom.
 */
export function createCountryBordersLayer(
  theme: ResolvedTheme = "light",
): maplibregl.LineLayerSpecification {
  return {
    id: "country_borders",
    type: "line",
    source: "openmaptiles",
    "source-layer": "boundary",
    filter: [
      "all",
      ["==", ["get", "admin_level"], 2],
      ["!=", ["get", "maritime"], 1],
      ["!", ["has", "claimed_by"]],
    ],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": theme === "dark" ? COLORS.countryBorderDark : COLORS.countryBorder,
      "line-opacity": OPACITIES.countryBorder,
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        4,
        WIDTHS.countryBorder.z4,
        10,
        WIDTHS.countryBorder.z10,
      ],
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

async function fetchBasemapStyle(theme: ResolvedTheme): Promise<BasemapStyle> {
  const url = BASEMAP_STYLE_URLS[theme];
  const response = await fetch(url, {
    signal: AbortSignal.timeout(STYLE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}`);
  }
  const style = (await response.json()) as maplibregl.StyleSpecification;
  if (!style.sources || !style.layers) {
    throw new Error(`${url} returned no sources or layers`);
  }
  return {
    sources: style.sources,
    layers: filterPointsFromParkOutlines(
      latinizeLabels(flattenBuildings(dropPoiLayers(style.layers))),
    ),
    glyphs: style.glyphs,
    sprite: style.sprite,
  };
}

/** Memoised per theme: switching schemes rebuilds the map and re-enters here. */
const pendingStyles: Partial<Record<ResolvedTheme, Promise<BasemapStyle | null>>> = {};

/**
 * The style, fetched once per page load and shared - both maps mount it, and a
 * region switch rebuilds the map from scratch.
 *
 * Resolves `null` rather than rejecting when the style is unreachable: the
 * caller then builds the raster basemap instead, because a railway map with a
 * plain OSM background is still usable and one with no background at all is
 * not. A failure clears the memo, so the next map to mount tries again.
 */
export function loadBasemapStyle(theme: ResolvedTheme = "light"): Promise<BasemapStyle | null> {
  const cached = pendingStyles[theme];
  if (cached) return cached;
  const pending = fetchBasemapStyle(theme).catch((error) => {
    console.warn("Vector basemap unavailable, falling back to OSM raster tiles", error);
    delete pendingStyles[theme];
    return null;
  });
  pendingStyles[theme] = pending;
  return pending;
}

export function createOSMBackgroundLayer(
  theme: ResolvedTheme = "light",
): maplibregl.RasterLayerSpecification {
  const dark = theme === "dark";
  return {
    id: "background",
    type: "raster",
    source: "osm",
    minzoom: 4,
    maxzoom: 19, // has to be higher than the map max zoom
    paint: {
      "raster-fade-duration": 0,
      "raster-saturation": dark ? -0.5 : 0,
      // These tiles are printed on white and there is no invert filter in the raster
      // paint spec, so the dark fallback drops them most of the way toward the black
      // ground layer beneath (createOSMBackgroundGroundLayer) instead. It is a dim
      // grey basemap rather than a designed dark one - which is the deal the whole
      // raster fallback makes: a usable map beats no map.
      "raster-opacity": dark ? 0.3 : 0.6,
    },
  };
}

/**
 * The black ground the dark raster fallback fades its tiles into.
 *
 * The vector styles paint their own background layer; the raster path has none, so
 * without this the page's own surface shows through the 30% tiles and the "dark"
 * fallback comes out pale grey. Returns null for light, where the tiles at 60% over
 * white are exactly what they have always been.
 */
export function createOSMBackgroundGroundLayer(
  theme: ResolvedTheme,
): maplibregl.BackgroundLayerSpecification | null {
  if (theme !== "dark") return null;
  return { id: "background_ground", type: "background", paint: { "background-color": "#05070a" } };
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
