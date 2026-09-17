/**
 * The style object handed to `<Map mapStyle>` — the basemap, and nothing of ours.
 *
 * `loadBasemapStyle` is the web app's, transforms included: the POI drop, the
 * building flattening, the Latin label rewrite and the park-outline point filter all
 * apply to a fetched style object, and `mapStyle` accepts an object. **The Latin
 * rewrite is why this matters here and not only on the web**: the binding has no
 * `localizeLabels` prop (that is rnmapbox's), so without it the Japan region is
 * labelled in kanji.
 *
 * Our own sources and layers are *not* baked in. They are declared as `<VectorSource>`
 * / `<Layer>` children of the map, so a layer toggle is a re-render rather than a
 * style rebuild. What is baked in is the fade layer, last of the basemap's own layers
 * and therefore under every child: the children are appended above whatever the style
 * already had, which is the same order the web app builds by hand.
 *
 * Returns null while the fetch is in flight. The map is not mounted until it
 * resolves — MapLibre takes one style object at construction, and a `mapStyle` that
 * changes identity would restart the map — and `loadBasemapStyle` resolves null
 * rather than rejecting on a failure or a 6s timeout, which is what puts the raster
 * fallback here rather than in an error branch.
 */
import type { StyleSpecification } from "@maplibre/maplibre-react-native";
import {
  createBasemapFadeLayer,
  createOSMBackgroundGroundLayer,
  createOSMBackgroundLayer,
  GLYPHS_URL,
  loadBasemapStyle,
  OSM_TILES_URL,
} from "@shared/map/basemap";
import { useEffect, useState } from "react";
import type { ResolvedTheme } from "@/theme/ThemeContext";

function rasterFallbackStyle(theme: ResolvedTheme): StyleSpecification {
  return {
    version: 8,
    // Our station labels need glyphs whichever basemap we ended up with, so the
    // fallback declares the endpoint the vector style would have brought.
    glyphs: GLYPHS_URL,
    sources: {
      osm: {
        type: "raster",
        tiles: [OSM_TILES_URL],
        tileSize: 256,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    // The raster tiles carry their own opacity and need no fade layer; in dark mode
    // they are dropped most of the way toward a black ground instead.
    layers: [createOSMBackgroundGroundLayer(theme), createOSMBackgroundLayer(theme)].filter(
      (layer) => layer !== null,
    ),
  };
}

export function useBasemapStyle(theme: ResolvedTheme): StyleSpecification | null {
  const [style, setStyle] = useState<StyleSpecification | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A scheme change swaps the whole style (liberty for OpenFreeMap's dark), so the
    // old one must not stay on screen under the new scheme's labels.
    setStyle(null);

    void loadBasemapStyle(theme).then((basemap) => {
      if (cancelled) return;
      if (!basemap) {
        setStyle(rasterFallbackStyle(theme));
        return;
      }
      setStyle({
        version: 8,
        glyphs: basemap.glyphs ?? GLYPHS_URL,
        // Only the vector basemap's own icon layers use the sprite.
        sprite: basemap.sprite,
        sources: basemap.sources,
        layers: [...basemap.layers, createBasemapFadeLayer(theme)],
      });
    });

    return () => {
      cancelled = true;
    };
  }, [theme]);

  return style;
}
