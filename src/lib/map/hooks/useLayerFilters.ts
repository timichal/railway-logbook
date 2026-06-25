import type maplibregl from "maplibre-gl";
import type { FilterSpecification } from "maplibre-gl";
import { useEffect } from "react";

/**
 * Manages filter and visibility toggles for user map layers:
 * - Special lines filter (show/hide non-regular routes). The single toggle
 *   reveals both Heritage (usage_type=1, solid) and Diversion (usage_type=2,
 *   dashed) lines together.
 * - Scenic outline visibility
 *
 * Layer responsibilities:
 * - `railway_routes` (visible solid line): Regular only, or Regular + Heritage
 *   when special shown. Never draws Diversions — those are dashed by their own
 *   layer, and a solid line underneath would fill the dash gaps.
 * - `railway_routes_diversion` (visible dashed line): only Diversions, toggled
 *   visible/hidden with the special-lines checkbox.
 * - `railway_routes_click` (invisible hit area): everything currently visible,
 *   including Diversions, so they stay tappable.
 */
export function useLayerFilters(
  map: React.MutableRefObject<maplibregl.Map | null>,
  showSpecialLines: boolean,
  showScenicOutline: boolean,
  /** Apply persisted preferences once the map's layers exist. */
  mapLoaded: boolean,
  /** Re-apply filters/visibility after a tile refresh re-adds the route layers. */
  cacheBuster?: number,
) {
  // Special lines filter
  // biome-ignore lint/correctness/useExhaustiveDependencies: mapLoaded and cacheBuster are intentional re-run triggers (apply prefs once layers exist / re-apply after a tile refresh re-adds layers), not values read inside the effect.
  useEffect(() => {
    const m = map.current;
    if (!m?.getLayer("railway_routes")) return;

    // Visible solid line: exclude Diversions always (they're drawn dashed).
    const solidFilter: FilterSpecification = showSpecialLines
      ? ["!=", ["get", "usage_type"], 2]
      : ["==", ["get", "usage_type"], 0];
    m.setFilter("railway_routes", solidFilter);

    // Dashed Diversion layer: visible only when special lines are shown.
    if (m.getLayer("railway_routes_diversion")) {
      m.setLayoutProperty(
        "railway_routes_diversion",
        "visibility",
        showSpecialLines ? "visible" : "none",
      );
    }

    // Click/hit buffer: everything visible should be clickable, Diversions too.
    if (m.getLayer("railway_routes_click")) {
      const clickFilter: FilterSpecification | null = showSpecialLines
        ? null
        : ["==", ["get", "usage_type"], 0];
      m.setFilter("railway_routes_click", clickFilter);
    }

    // Scenic outline: mirror the visible solid line (exclude Diversions).
    if (m.getLayer("railway_routes_scenic_outline")) {
      const scenicFilter: FilterSpecification = showSpecialLines
        ? ["all", ["==", ["get", "scenic"], true], ["!=", ["get", "usage_type"], 2]]
        : ["all", ["==", ["get", "scenic"], true], ["==", ["get", "usage_type"], 0]];
      m.setFilter("railway_routes_scenic_outline", scenicFilter);
    }
  }, [map, showSpecialLines, mapLoaded, cacheBuster]);

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
