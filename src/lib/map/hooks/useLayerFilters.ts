import type * as maplibregl from "maplibre-gl";
import { useEffect } from "react";
import { SCENIC_LINES_LAYER_ID } from "@/lib/shared/map/layers";
import { clickBufferFilter, scenicLinesFilter } from "@/lib/shared/map/userMapLayers";

/**
 * Manages filter and visibility toggles for user map layers:
 * - Heritage (usage_type=1, dotted) — "Show heritage lines" toggle.
 * - Special services (usage_type=2, dashed) — "Show special services" toggle.
 *   The two are independent.
 * - Scenic lines: visibility, and the country filter the routes have too
 *
 * Layer responsibilities:
 * - `railway_routes` (visible solid line): Regular only. Heritage and Special
 *   each have their own non-solid layer; a solid line under them would fill the
 *   dash/dot gaps.
 * - `railway_routes_heritage` (visible dotted line): only Heritage routes,
 *   toggled visible/hidden with the heritage checkbox.
 * - `railway_routes_special` (visible dashed line): only Special routes, toggled
 *   visible/hidden with the special-services checkbox.
 * - `railway_routes_click` (invisible hit area): everything currently visible,
 *   so each shown route stays tappable.
 */
export function useLayerFilters(
  map: React.MutableRefObject<maplibregl.Map | null>,
  showHeritage: boolean,
  showSpecial: boolean,
  showScenicLines: boolean,
  /** The countries the routes are filtered to; the scenic lines follow them. */
  selectedCountries: string[],
  /** Apply persisted preferences once the map's layers exist. */
  mapLoaded: boolean,
) {
  // Usage-type filters
  // biome-ignore lint/correctness/useExhaustiveDependencies: mapLoaded is an intentional re-run trigger (apply prefs once layers exist), not a value read inside the effect.
  useEffect(() => {
    const m = map.current;
    if (!m?.getLayer("railway_routes")) return;

    // Visible solid line: Regular only. Heritage (dotted) and Special (dashed)
    // are drawn by their own layers.
    m.setFilter("railway_routes", ["==", ["get", "usage_type"], 0]);

    // Dotted Heritage layer: visible only when heritage lines are shown.
    if (m.getLayer("railway_routes_heritage")) {
      m.setLayoutProperty(
        "railway_routes_heritage",
        "visibility",
        showHeritage ? "visible" : "none",
      );
    }

    // Dashed Special layer: visible only when special services are shown.
    if (m.getLayer("railway_routes_special")) {
      m.setLayoutProperty("railway_routes_special", "visibility", showSpecial ? "visible" : "none");
    }

    // Click/hit buffer: every currently-visible usage type should be clickable.
    if (m.getLayer("railway_routes_click")) {
      m.setFilter("railway_routes_click", clickBufferFilter(showHeritage, showSpecial));
    }
  }, [map, showHeritage, showSpecial, mapLoaded]);

  // Scenic lines: shown by their toggle, filtered by country as the routes are
  // biome-ignore lint/correctness/useExhaustiveDependencies: mapLoaded is an intentional re-run trigger (apply prefs once layers exist), not a value read inside the effect.
  useEffect(() => {
    const m = map.current;
    if (!m?.getLayer(SCENIC_LINES_LAYER_ID)) return;

    m.setLayoutProperty(SCENIC_LINES_LAYER_ID, "visibility", showScenicLines ? "visible" : "none");
    m.setFilter(SCENIC_LINES_LAYER_ID, scenicLinesFilter(selectedCountries));
  }, [map, showScenicLines, selectedCountries, mapLoaded]);
}
