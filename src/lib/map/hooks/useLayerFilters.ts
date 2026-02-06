import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import type { FilterSpecification } from 'maplibre-gl';

/**
 * Manages filter and visibility toggles for user map layers:
 * - Special lines filter (show/hide usage_type=1 routes)
 * - Scenic outline visibility
 */
export function useLayerFilters(
  map: React.MutableRefObject<maplibregl.Map | null>,
  showSpecialLines: boolean,
  showScenicOutline: boolean,
) {
  // Special lines filter
  useEffect(() => {
    if (!map.current || !map.current.getLayer('railway_routes')) return;

    const filter: FilterSpecification | null = showSpecialLines
      ? null
      : ['!=', ['get', 'usage_type'], 1];

    map.current.setFilter('railway_routes', filter);

    if (map.current.getLayer('railway_routes_scenic_outline')) {
      const scenicFilter: FilterSpecification = showSpecialLines
        ? ['==', ['get', 'scenic'], true]
        : ['all', ['==', ['get', 'scenic'], true], ['!=', ['get', 'usage_type'], 1]];
      map.current.setFilter('railway_routes_scenic_outline', scenicFilter);
    }
  }, [map, showSpecialLines]);

  // Scenic outline visibility
  useEffect(() => {
    if (!map.current || !map.current.getLayer('railway_routes_scenic_outline')) return;

    map.current.setLayoutProperty(
      'railway_routes_scenic_outline',
      'visibility',
      showScenicOutline ? 'visible' : 'none',
    );
  }, [map, showScenicOutline]);
}
