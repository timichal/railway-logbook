'use client';

import { useEffect, useRef, useState } from 'react';
import type { RailwayPart, GeoJSONFeatureCollection } from '@/lib/types';
import { useMapLibre } from '@/lib/map/hooks/useMapLibre';
import { useRouteLength } from '@/lib/map/hooks/useRouteLength';
import { useAdminLayerVisibility } from '@/lib/map/hooks/useAdminLayerVisibility';
import { useAdminMapOverlays } from '@/lib/map/hooks/useAdminMapOverlays';
import { useAdminNotesPopup } from '@/lib/map/hooks/useAdminNotesPopup';
import {
  createRailwayRoutesSource,
  createRailwayRoutesLayer,
  createScenicRoutesOutlineLayer,
  createRailwayPartsSource,
  createRailwayPartsLayer,
  createStationsSource,
  createStationsLayer,
  createAdminNotesSource,
  createAdminNotesLayer,
  COLORS,
} from '@/lib/map';
import { setupAdminMapInteractions } from '@/lib/map/interactions/adminMapInteractions';
import { getAllRouteEndpoints } from '@/lib/adminRouteActions';
import AdminLayerControls from './AdminLayerControls';

interface VectorAdminMapProps {
  className?: string;
  onCoordinateClick?: (coordinate: [number, number]) => void;
  onRouteSelect?: (routeId: string) => void;
  selectedRouteId?: string | null;
  previewRoute?: { partIds: string[], coordinates: [number, number][], railwayParts?: RailwayPart[] } | null;
  selectedCoordinates?: { startingCoordinate: [number, number] | null, endingCoordinate: [number, number] | null };
  refreshTrigger?: number;
  isEditingGeometry?: boolean;
  focusGeometry?: string | null;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
}

export default function VectorAdminMap({
  className = '',
  onCoordinateClick,
  onRouteSelect,
  selectedRouteId,
  previewRoute,
  selectedCoordinates,
  refreshTrigger,
  isEditingGeometry,
  focusGeometry,
  showSuccess,
  showError,
}: VectorAdminMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [routesCacheBuster, setRoutesCacheBuster] = useState(Date.now());
  const [routeEndpoints, setRouteEndpoints] = useState<GeoJSONFeatureCollection | null>(null);

  const { previewLength, selectedRouteLength } = useRouteLength(previewRoute, selectedRouteId);

  // Store callbacks in refs to avoid map recreation on changes
  const onCoordinateClickRef = useRef(onCoordinateClick);
  const onRouteSelectRef = useRef(onRouteSelect);
  onCoordinateClickRef.current = onCoordinateClick;
  onRouteSelectRef.current = onRouteSelect;

  // Initialize map
  const { map, mapLoaded } = useMapLibre(
    mapContainer,
    {
      sources: {
        railway_parts: createRailwayPartsSource(),
        railway_routes: createRailwayRoutesSource({ cacheBuster: routesCacheBuster }),
        stations: createStationsSource(),
        admin_notes: createAdminNotesSource(),
      },
      layers: [
        createRailwayPartsLayer(),
        createScenicRoutesOutlineLayer(),
        createRailwayRoutesLayer(),
        createStationsLayer(),
        createAdminNotesLayer(),
      ],
      onLoad: (mapInstance) => {
        setupAdminMapInteractions(mapInstance, {
          onCoordinateClickRef,
          onRouteSelectRef,
        });
      },
    },
    []
  );

  // Layer visibility management
  const layerVisibility = useAdminLayerVisibility({ map, mapLoaded, isEditingGeometry });

  // GeoJSON overlay layers (preview route, selected points, route endpoints)
  useAdminMapOverlays(map, mapLoaded, {
    previewRoute,
    selectedCoordinates,
    routeEndpoints,
    isEditingGeometry,
  });

  // Notes popup system
  useAdminNotesPopup({
    map,
    mapLoaded,
    showNotesLayer: layerVisibility.showNotesLayer,
    showSuccess,
    showError,
  });

  // Fetch route endpoints
  useEffect(() => {
    if (!mapLoaded) return;
    getAllRouteEndpoints()
      .then(setRouteEndpoints)
      .catch((error) => console.error('Error fetching route endpoints:', error));
  }, [mapLoaded, refreshTrigger]);

  // Selected route highlighting
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    if (selectedRouteId) {
      const trackIdNum = parseInt(selectedRouteId, 10);

      map.current.setPaintProperty('railway_routes', 'line-color', [
        'case',
        ['==', ['id'], trackIdNum],
        COLORS.railwayRoutes.selected,
        ['==', ['get', 'is_valid'], false],
        COLORS.railwayRoutes.invalid,
        COLORS.railwayRoutes.created,
      ]);
      map.current.setPaintProperty('railway_routes', 'line-width', [
        'case',
        ['==', ['id'], trackIdNum],
        5,
        ['==', ['get', 'usage_type'], 1],
        2,
        3,
      ]);
      map.current.setPaintProperty('railway_routes', 'line-opacity', [
        'case',
        ['==', ['id'], trackIdNum],
        1.0,
        0.8,
      ]);
    } else {
      map.current.setPaintProperty('railway_routes', 'line-color', [
        'case',
        ['==', ['get', 'is_valid'], false],
        COLORS.railwayRoutes.invalid,
        COLORS.railwayRoutes.created,
      ]);
      map.current.setPaintProperty('railway_routes', 'line-width', [
        'case',
        ['==', ['get', 'usage_type'], 1],
        2,
        3,
      ]);
      map.current.setPaintProperty('railway_routes', 'line-opacity', 0.8);
    }
  }, [selectedRouteId, mapLoaded, map]);

  // Refresh routes tiles when routes are saved/deleted
  useEffect(() => {
    if (!map.current || !mapLoaded || refreshTrigger === undefined || refreshTrigger === 0) return;

    const newCacheBuster = Date.now();
    setRoutesCacheBuster(newCacheBuster);

    // Remove layers → source → re-add
    const m = map.current;
    if (m.getLayer('railway_routes')) m.removeLayer('railway_routes');
    if (m.getLayer('railway_routes_scenic_outline')) m.removeLayer('railway_routes_scenic_outline');
    if (m.getSource('railway_routes')) m.removeSource('railway_routes');

    m.addSource('railway_routes', createRailwayRoutesSource({ cacheBuster: newCacheBuster }));
    m.addLayer(createScenicRoutesOutlineLayer());
    m.addLayer(createRailwayRoutesLayer());

    // Re-apply visibility
    const visibility = layerVisibility.showRoutesLayer ? 'visible' : 'none';
    m.setLayoutProperty('railway_routes', 'visibility', visibility);
    m.setLayoutProperty('railway_routes_scenic_outline', 'visibility', visibility);

    // Re-apply selected route highlighting
    if (selectedRouteId) {
      const trackIdNum = parseInt(selectedRouteId, 10);
      m.setPaintProperty('railway_routes', 'line-color', [
        'case',
        ['==', ['id'], trackIdNum],
        COLORS.railwayRoutes.selected,
        ['==', ['get', 'is_valid'], false],
        COLORS.railwayRoutes.invalid,
        COLORS.railwayRoutes.created,
      ]);
      m.setPaintProperty('railway_routes', 'line-width', [
        'case',
        ['==', ['id'], trackIdNum],
        5,
        ['==', ['get', 'usage_type'], 1],
        2,
        3,
      ]);
      m.setPaintProperty('railway_routes', 'line-opacity', [
        'case',
        ['==', ['id'], trackIdNum],
        1.0,
        0.8,
      ]);
    } else {
      m.setPaintProperty('railway_routes', 'line-color', [
        'case',
        ['==', ['get', 'is_valid'], false],
        COLORS.railwayRoutes.invalid,
        COLORS.railwayRoutes.created,
      ]);
      m.setPaintProperty('railway_routes', 'line-width', [
        'case',
        ['==', ['get', 'usage_type'], 1],
        2,
        3,
      ]);
    }

    m.triggerRepaint();
  }, [refreshTrigger, mapLoaded, layerVisibility.showRoutesLayer, selectedRouteId, map]);

  // Focus on route geometry
  useEffect(() => {
    if (!map.current || !mapLoaded || !focusGeometry || isEditingGeometry) return;

    try {
      const geojson = JSON.parse(focusGeometry);
      if (geojson?.type === 'LineString' && geojson.coordinates) {
        const coordinates = geojson.coordinates as [number, number][];
        const lngs = coordinates.map(coord => coord[0]);
        const lats = coordinates.map(coord => coord[1]);
        const bounds: [[number, number], [number, number]] = [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ];
        map.current.fitBounds(bounds, { padding: 80, duration: 1000, maxZoom: 13 });
      }
    } catch (error) {
      console.error('Error parsing geometry for focus:', error);
    }
  }, [focusGeometry, mapLoaded, isEditingGeometry, map]);

  return (
    <div className={`${className} relative`}>
      <div ref={mapContainer} className="w-full h-full" />

      <AdminLayerControls {...layerVisibility} />

      {(previewLength !== null || selectedRouteLength !== null) && (
        <div className="absolute top-4 right-4 bg-white p-3 rounded shadow-lg text-black z-10">
          <h3 className="font-bold mb-2">Route Length</h3>
          {previewLength !== null && (
            <div className="text-sm">
              Preview: <span className="font-semibold">{previewLength.toFixed(1)} km</span>
            </div>
          )}
          {selectedRouteLength !== null && previewLength === null && (
            <div className="text-sm">
              Selected: <span className="font-semibold">{selectedRouteLength.toFixed(1)} km</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
