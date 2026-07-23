import type * as maplibregl from "maplibre-gl";
import type { FilterSpecification } from "maplibre-gl";
import { useEffect } from "react";

/**
 * Manages filter and visibility toggles for user map layers:
 * - Heritage (usage_type=1, dotted) — "Show heritage lines" toggle.
 * - Special services (usage_type=2, dashed) — "Show special services" toggle.
 *   The two are independent.
 * - Scenic outline visibility
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
  showScenicOutline: boolean,
  /** Apply persisted preferences once the map's layers exist. */
  mapLoaded: boolean,
  /** Re-apply filters/visibility after a tile refresh re-adds the route layers. */
  cacheBuster?: number,
) {
  // Usage-type filters
  // biome-ignore lint/correctness/useExhaustiveDependencies: mapLoaded and cacheBuster are intentional re-run triggers (apply prefs once layers exist / re-apply after a tile refresh re-adds layers), not values read inside the effect.
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
      const clickable = [0]; // Regular always
      if (showHeritage) clickable.push(1);
      if (showSpecial) clickable.push(2);
      const clickFilter: FilterSpecification | null =
        clickable.length === 3
          ? null
          : (["match", ["get", "usage_type"], clickable, true, false] as FilterSpecification);
      m.setFilter("railway_routes_click", clickFilter);
    }

    // Scenic outline: mirror the visible solid line (never Special routes).
    if (m.getLayer("railway_routes_scenic_outline")) {
      const scenicFilter: FilterSpecification = showHeritage
        ? ["all", ["==", ["get", "scenic"], true], ["!=", ["get", "usage_type"], 2]]
        : ["all", ["==", ["get", "scenic"], true], ["==", ["get", "usage_type"], 0]];
      m.setFilter("railway_routes_scenic_outline", scenicFilter);
    }
  }, [map, showHeritage, showSpecial, mapLoaded, cacheBuster]);

  // Scenic outline visibility
  // biome-ignore lint/correctness/useExhaustiveDependencies: mapLoaded and cacheBuster are intentional re-run triggers (apply prefs once layers exist / re-apply after a tile refresh re-adds layers), not values read inside the effect.
  useEffect(() => {
    if (!map.current?.getLayer("railway_routes_scenic_outline")) return;

    map.current.setLayoutProperty(
      "railway_routes_scenic_outline",
      "visibility",
      showScenicOutline ? "visible" : "none",
    );
  }, [map, showScenicOutline, mapLoaded, cacheBuster]);
}
