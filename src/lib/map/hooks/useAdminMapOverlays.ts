import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import type { RailwayPart, GeoJSONFeatureCollection } from '@/lib/types';
import { COLORS } from '../index';

interface OverlayData {
  previewRoute?: { partIds: string[]; coordinates: [number, number][]; railwayParts?: RailwayPart[] } | null;
  selectedCoordinates?: { startingCoordinate: [number, number] | null; endingCoordinate: [number, number] | null };
  routeEndpoints: GeoJSONFeatureCollection | null;
  isEditingGeometry?: boolean;
}

/**
 * Remove a GeoJSON layer and its source from the map if they exist.
 */
function removeGeoJSONLayer(mapInstance: maplibregl.Map, id: string) {
  if (mapInstance.getLayer(id)) mapInstance.removeLayer(id);
  if (mapInstance.getSource(id)) mapInstance.removeSource(id);
}

/**
 * Manages GeoJSON overlay layers on the admin map:
 * - Preview route (line)
 * - Selected coordinate points (circles)
 * - Route endpoints (circles)
 */
export function useAdminMapOverlays(
  map: React.MutableRefObject<maplibregl.Map | null>,
  mapLoaded: boolean,
  data: OverlayData,
) {
  const { previewRoute, selectedCoordinates, routeEndpoints, isEditingGeometry } = data;

  // Preview route overlay
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    removeGeoJSONLayer(map.current, 'preview-route');

    if (previewRoute?.coordinates && previewRoute.coordinates.length > 0) {
      map.current.addSource('preview-route', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: previewRoute.coordinates },
            properties: {},
          }],
        },
      });

      map.current.addLayer({
        id: 'preview-route',
        type: 'line',
        source: 'preview-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': COLORS.preview, 'line-width': 8, 'line-opacity': 1.0 },
      });

    }
  }, [previewRoute, mapLoaded, isEditingGeometry, map]);

  // Selected coordinate points overlay
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    removeGeoJSONLayer(map.current, 'selected-points');

    const features: Array<{
      type: 'Feature';
      geometry: { type: 'Point'; coordinates: [number, number] };
      properties: { type: string };
    }> = [];

    if (selectedCoordinates?.startingCoordinate) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: selectedCoordinates.startingCoordinate },
        properties: { type: 'start' },
      });
    }

    if (selectedCoordinates?.endingCoordinate) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: selectedCoordinates.endingCoordinate },
        properties: { type: 'end' },
      });
    }

    if (features.length > 0) {
      map.current.addSource('selected-points', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });

      map.current.addLayer({
        id: 'selected-points',
        type: 'circle',
        source: 'selected-points',
        paint: {
          'circle-radius': 8,
          'circle-color': [
            'case',
            ['==', ['get', 'type'], 'start'],
            '#16a34a', // Green for start
            '#dc2626', // Red for end
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 1.0,
        },
      });
    }
  }, [selectedCoordinates, mapLoaded, map]);

  // Route endpoints overlay
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    removeGeoJSONLayer(map.current, 'route-endpoints');

    if (routeEndpoints && routeEndpoints.features.length > 0) {
      map.current.addSource('route-endpoints', {
        type: 'geojson',
        data: routeEndpoints,
      });

      map.current.addLayer({
        id: 'route-endpoints',
        type: 'circle',
        source: 'route-endpoints',
        paint: {
          'circle-radius': 5,
          'circle-color': '#3b82f6',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.8,
        },
      });
    }
  }, [routeEndpoints, mapLoaded, map]);
}
