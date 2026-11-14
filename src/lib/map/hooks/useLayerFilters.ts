import type * as maplibregl from "maplibre-gl";
import { useEffect } from "react";
import { type UsageType, usageOptions } from "@/lib/shared/constants";
import {
  bothFilters,
  ROUTE_CLICK_LAYER_ID,
  routeLineLayerId,
  SCENIC_LINES_LAYER_ID,
} from "@/lib/shared/map/layers";
import {
  clickBufferFilter,
  scenicLinesFilter,
  userRouteLineFilter,
  userRoutesFilter,
} from "@/lib/shared/map/userMapLayers";

/**
 * Manages filter and visibility toggles for user map layers:
 * - Regular (usage_type=0, solid) — shown everywhere, except that Japan's JR lines
 *   can be unticked in the Map & Stats tab.
 * - Heritage (usage_type=1, dotted) — "Show heritage lines" toggle.
 * - Special services (usage_type=2, dashed) — "Show special services" toggle, or
 *   Japan's non-JR lines, ticked in the Map & Stats tab.
 *   All three are independent.
 * - Countries: on every route layer and the scenic lines, only routes with both
 *   ends in a selected country (`countryFilter`). On the client, not in the tile
 *   URL, so a country toggle refetches nothing.
 * - Scenic lines: visibility
 * - Closed lines: on every route layer, those not ridden are filtered out unless
 *   "All closed lines" is on (`closedRoutesFilter`)
 *
 * Layer responsibilities:
 * - `railway_routes` (visible solid line): Regular only. Heritage and Special
 *   each have their own non-solid layer; a solid line under them would fill the
 *   dash/dot gaps. Hidden when Regular is switched off.
 * - `railway_routes_heritage` (visible dotted line): only Heritage routes,
 *   toggled visible/hidden with the heritage checkbox.
 * - `railway_routes_special` (visible dashed line): only Special routes, toggled
 *   visible/hidden with the special-services checkbox.
 * - `railway_routes_click` (invisible hit area): everything currently visible,
 *   so each shown route stays tappable.
 */
export function useLayerFilters(
  map: React.RefObject<maplibregl.Map | null>,
  /** The usage types shown (`shownUsageTypes`). */
  shownTypes: UsageType[],
  showScenicLines: boolean,
  /** The countries the routes and the scenic lines are filtered to. */
  selectedCountries: string[],
  /** "All closed lines". */
  showClosed: boolean,
  /** An anonymous visitor's ridden routes (see `closedRoutesFilter`); empty otherwise. */
  localRiddenTrackIds: readonly number[],
  /** Apply persisted preferences once the map's layers exist. */
  mapLoaded: boolean,
) {
  // Route filters: usage type, country, closed
  // biome-ignore lint/correctness/useExhaustiveDependencies: mapLoaded is an intentional re-run trigger (apply prefs once layers exist), not a value read inside the effect.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const options = { countries: selectedCountries, showClosed, localRiddenTrackIds };
    for (const { id: type } of usageOptions) {
      const id = routeLineLayerId(type);
      if (m.getLayer(id)) {
        m.setLayoutProperty(id, "visibility", shownTypes.includes(type) ? "visible" : "none");
        m.setFilter(id, userRouteLineFilter(type, options));
      }
    }
    if (m.getLayer(ROUTE_CLICK_LAYER_ID)) {
      m.setFilter(
        ROUTE_CLICK_LAYER_ID,
        bothFilters(clickBufferFilter(shownTypes), userRoutesFilter(options)),
      );
    }
  }, [map, shownTypes, selectedCountries, showClosed, localRiddenTrackIds, mapLoaded]);

  // Scenic lines: shown by their toggle, filtered by country as the routes are
  // biome-ignore lint/correctness/useExhaustiveDependencies: mapLoaded is an intentional re-run trigger (apply prefs once layers exist), not a value read inside the effect.
  useEffect(() => {
    const m = map.current;
    if (!m?.getLayer(SCENIC_LINES_LAYER_ID)) return;

    m.setLayoutProperty(SCENIC_LINES_LAYER_ID, "visibility", showScenicLines ? "visible" : "none");
    m.setFilter(SCENIC_LINES_LAYER_ID, scenicLinesFilter(selectedCountries));
  }, [map, showScenicLines, selectedCountries, mapLoaded]);
}
