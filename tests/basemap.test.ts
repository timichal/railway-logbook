import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { basemapLayers, transformBasemapLayers } from "@/lib/shared/map/basemap";
import { OPACITIES } from "@/lib/shared/map/style";

/** A slice of an OpenMapTiles style: ground, a road name, two place layers. */
function styleLayers(): LayerSpecification[] {
  return [
    { id: "background", type: "background", paint: { "background-color": "#000" } },
    { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water" },
    {
      id: "highway_name",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "transportation_name",
      layout: { "text-field": ["get", "name"] },
    },
    {
      id: "place_town",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      layout: { "text-field": ["get", "name"], "text-size": 10, "icon-image": "circle-11" },
      paint: { "text-color": "rgb(101,101,101)", "icon-opacity": 0.7 },
    },
    {
      id: "place_country",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      layout: {
        "text-field": ["get", "name"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 0, 10, 4, 14],
      },
    },
  ];
}

function stack(theme: "light" | "dark"): string[] {
  const { layers, labels } = transformBasemapLayers(styleLayers(), theme);
  return basemapLayers({ sources: {}, layers, labels }, theme).map((layer) => layer.id);
}

describe("basemap stack", () => {
  test("dark: place names go above the fade and the borders", () => {
    assert.deepEqual(stack("dark"), [
      "background",
      "water",
      "highway_name",
      "basemap_fade",
      "country_borders",
      "place_town",
      "place_country",
    ]);
  });

  test("light: the style's own order, fade and borders on top", () => {
    assert.deepEqual(stack("light"), [
      "background",
      "water",
      "highway_name",
      "place_town",
      "place_country",
      "basemap_fade",
      "country_borders",
    ]);
  });

  test("dark: every lifted place layer is restyled in full, its dot dimmed", () => {
    const { labels } = transformBasemapLayers(styleLayers(), "dark");
    for (const layer of labels) {
      assert.equal(layer.type, "symbol");
      if (layer.type !== "symbol") continue;
      // A zoom curve upstream (the country layer) is replaced like a constant.
      const size = layer.layout?.["text-size"];
      assert.ok(Array.isArray(size) && size[0] === "match", `${layer.id} text-size`);
      const color = layer.paint?.["text-color"];
      assert.ok(Array.isArray(color) && color[0] === "match", `${layer.id} text-color`);
      assert.equal(layer.paint?.["icon-opacity"], OPACITIES.placeIconDark);
    }
  });

  test("the memoised input layers are not mutated", () => {
    const input = styleLayers();
    const before = JSON.stringify(input);
    transformBasemapLayers(input, "dark");
    assert.equal(JSON.stringify(input), before);
  });
});
