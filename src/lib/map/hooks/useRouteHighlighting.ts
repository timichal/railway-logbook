import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import type { SelectedRoute } from '@/lib/types';

/**
 * Manages highlight overlay layers on the user map:
 * - Gold highlights from Journey Planner
 * - Green/Red/Orange highlights from Route Logger selection
 */
export function useRouteHighlighting(
  map: React.MutableRefObject<maplibregl.Map | null>,
  highlightedRoutes: number[],
  selectedRoutes: SelectedRoute[],
) {
  // Journey planner highlights (gold)
  useEffect(() => {
    if (!map.current || !map.current.getLayer('railway_routes')) return;

    if (highlightedRoutes.length > 0) {
      if (!map.current.getLayer('highlighted_routes')) {
        map.current.addLayer({
          id: 'highlighted_routes',
          type: 'line',
          source: 'railway_routes',
          'source-layer': 'railway_routes',
          paint: {
            'line-color': '#FFD700',
            'line-width': 6,
            'line-opacity': 0.8,
          },
          filter: ['in', ['id'], ['literal', highlightedRoutes]],
        });
      } else {
        map.current.setFilter('highlighted_routes', [
          'in', ['id'], ['literal', highlightedRoutes],
        ]);
      }
    } else {
      if (map.current.getLayer('highlighted_routes')) {
        map.current.removeLayer('highlighted_routes');
      }
    }
  }, [map, highlightedRoutes]);

  // Selected routes highlights (green/orange/red)
  useEffect(() => {
    if (!map.current || !map.current.getLayer('railway_routes')) return;

    const selectedTrackIds = selectedRoutes.map(r => parseInt(r.track_id));

    if (selectedTrackIds.length > 0) {
      if (!map.current.getLayer('selected_routes_highlight')) {
        map.current.addLayer({
          id: 'selected_routes_highlight',
          type: 'line',
          source: 'railway_routes',
          'source-layer': 'railway_routes',
          paint: {
            'line-color': [
              'case',
              ['all', ['has', 'date'], ['==', ['get', 'has_complete_trip'], true]],
              '#059669', // Green
              ['has', 'date'],
              '#d97706', // Orange
              ['all', ['==', ['feature-state', 'hasTrip'], true], ['==', ['feature-state', 'partial'], true]],
              '#d97706', // Orange
              ['==', ['feature-state', 'hasTrip'], true],
              '#059669', // Green
              '#DC2626',  // Red
            ],
            'line-width': 7,
            'line-opacity': 0.9,
          },
          filter: ['in', ['id'], ['literal', selectedTrackIds]],
        }, 'railway_routes');
      } else {
        map.current.setFilter('selected_routes_highlight', [
          'in', ['id'], ['literal', selectedTrackIds],
        ]);
      }
    } else {
      if (map.current.getLayer('selected_routes_highlight')) {
        map.current.removeLayer('selected_routes_highlight');
      }
    }
  }, [map, selectedRoutes]);
}
