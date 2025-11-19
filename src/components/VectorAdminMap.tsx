'use client';

import { useEffect, useRef, useState } from 'react';
import type { RailwayPart } from '@/lib/types';
import { useMapLibre } from '@/lib/map/hooks/useMapLibre';
import { useRouteLength } from '@/lib/map/hooks/useRouteLength';
import {
  createRailwayRoutesSource,
  createRailwayRoutesLayer,
  createRailwayPartsSource,
  createRailwayPartsLayer,
  createStationsSource,
  createStationsLayer,
  COLORS,
} from '@/lib/map';
import { setupAdminMapInteractions } from '@/lib/map/interactions/adminMapInteractions';

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
  onRefreshMap?: () => void;
  showError?: (message: string) => void;
  showSuccess?: (message: string) => void;
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
  onRefreshMap,
  showError,
  showSuccess,
}: VectorAdminMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [showPartsLayer, setShowPartsLayer] = useState(true);
  const [showRoutesLayer, setShowRoutesLayer] = useState(true);
  const [showStationsLayer, setShowStationsLayer] = useState(true);
  const [routesCacheBuster, setRoutesCacheBuster] = useState(Date.now());
  const previousShowRoutesLayerRef = useRef(true); // Track previous state before editing geometry

  // Use custom hook for route length management
  const { previewLength, selectedRouteLength } = useRouteLength(previewRoute, selectedRouteId);

  // Store callbacks and props in refs to avoid map recreation on changes
  const onCoordinateClickRef = useRef(onCoordinateClick);
  const onRouteSelectRef = useRef(onRouteSelect);
  const selectedCoordinatesRef = useRef(selectedCoordinates);
  const previewRouteRef = useRef(previewRoute);
  const updatePartsStyleRef = useRef<(() => void) | null>(null);
  const onRefreshMapRef = useRef(onRefreshMap);
  const showErrorRef = useRef(showError);
  const showSuccessRef = useRef(showSuccess);

  onCoordinateClickRef.current = onCoordinateClick;
  onRouteSelectRef.current = onRouteSelect;
  selectedCoordinatesRef.current = selectedCoordinates;
  previewRouteRef.current = previewRoute;
  onRefreshMapRef.current = onRefreshMap;
  showErrorRef.current = showError;
  showSuccessRef.current = showSuccess;

  // Initialize map with shared hook
  const { map, mapLoaded } = useMapLibre(
    mapContainer,
    {
      sources: {
        railway_parts: createRailwayPartsSource(),
        railway_routes: createRailwayRoutesSource({ cacheBuster: routesCacheBuster }),
        stations: createStationsSource(),
      },
      layers: [
        createRailwayPartsLayer(),
        createRailwayRoutesLayer(),
        createStationsLayer(),
      ],
      onLoad: (mapInstance) => {
        setupAdminMapInteractions(mapInstance, {
          onCoordinateClickRef,
          onRouteSelectRef,
          selectedCoordinatesRef,
          previewRouteRef,
          updatePartsStyleRef,
          showErrorRef,
          showSuccessRef,
          onRefreshMapRef,
        });
      },
    },
    [] // Only initialize once
  );

  // Update parts styling when selectedCoordinates change
  useEffect(() => {
    if (map.current && mapLoaded && updatePartsStyleRef.current) {
      requestAnimationFrame(() => {
        updatePartsStyleRef.current?.();
      });
    }
  }, [selectedCoordinates?.startingCoordinate, selectedCoordinates?.endingCoordinate, mapLoaded, map]);

  // Handle layer visibility toggles
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    map.current.setLayoutProperty(
      'railway_parts',
      'visibility',
      showPartsLayer ? 'visible' : 'none'
    );
  }, [showPartsLayer, mapLoaded, map]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    map.current.setLayoutProperty(
      'railway_routes',
      'visibility',
      showRoutesLayer ? 'visible' : 'none'
    );
  }, [showRoutesLayer, mapLoaded, map]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    map.current.setLayoutProperty(
      'stations',
      'visibility',
      showStationsLayer ? 'visible' : 'none'
    );
  }, [showStationsLayer, mapLoaded, map]);

  // Sync Railway Routes checkbox with edit geometry mode
  useEffect(() => {
    if (isEditingGeometry) {
      // Save current state and uncheck the checkbox
      previousShowRoutesLayerRef.current = showRoutesLayer;
      setShowRoutesLayer(false);
    } else {
      // Restore previous state when exiting edit mode
      setShowRoutesLayer(previousShowRoutesLayerRef.current);
    }
  }, [isEditingGeometry]); // Don't include showRoutesLayer to avoid infinite loop

  // Hide railway routes layer when editing geometry
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const hasLayer = map.current.getLayer('railway_routes');
    if (!hasLayer) return;

    if (isEditingGeometry) {
      // Hide the railway_routes layer
      map.current.setLayoutProperty('railway_routes', 'visibility', 'none');
    } else {
      // Restore the layer visibility based on showRoutesLayer
      map.current.setLayoutProperty(
        'railway_routes',
        'visibility',
        showRoutesLayer ? 'visible' : 'none'
      );
    }
  }, [isEditingGeometry, showRoutesLayer, mapLoaded, map]);

  // Handle selected route highlighting
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    if (selectedRouteId) {
      map.current.setPaintProperty('railway_routes', 'line-color', [
        'case',
        ['==', ['get', 'track_id'], selectedRouteId],
        COLORS.railwayRoutes.selected, // Selected routes always orange
        ['==', ['get', 'is_valid'], false],
        COLORS.railwayRoutes.invalid, // Unselected invalid routes are grey
        COLORS.railwayRoutes.created
      ]);
      map.current.setPaintProperty('railway_routes', 'line-width', [
        'case',
        ['==', ['get', 'track_id'], selectedRouteId],
        5,
        ['==', ['get', 'usage_type'], 1],
        2, // Special routes = thinner
        3  // Normal routes = standard width
      ]);
      map.current.setPaintProperty('railway_routes', 'line-opacity', [
        'case',
        ['==', ['get', 'track_id'], selectedRouteId],
        1.0,
        0.8
      ]);
    } else {
      map.current.setPaintProperty('railway_routes', 'line-color', [
        'case',
        ['==', ['get', 'is_valid'], false],
        COLORS.railwayRoutes.invalid,
        COLORS.railwayRoutes.created
      ]);
      map.current.setPaintProperty('railway_routes', 'line-width', [
        'case',
        ['==', ['get', 'usage_type'], 1],
        2, // Special routes = thinner
        3  // Normal routes = standard width
      ]);
      map.current.setPaintProperty('railway_routes', 'line-opacity', 0.8);
    }
  }, [selectedRouteId, mapLoaded, map]);

  // Handle railway routes refresh when routes are saved/deleted
  useEffect(() => {
    if (!map.current || !mapLoaded || refreshTrigger === undefined) return;
    if (refreshTrigger === 0) return; // Skip initial render

    // Update cache buster
    const newCacheBuster = Date.now();
    setRoutesCacheBuster(newCacheBuster);

    // Reload railway_routes tiles
    const hasRoutesLayer = map.current.getLayer('railway_routes');
    const hasRoutesSource = map.current.getSource('railway_routes');

    if (hasRoutesLayer) {
      map.current.removeLayer('railway_routes');
    }
    if (hasRoutesSource) {
      map.current.removeSource('railway_routes');
    }

    // Re-add source with new cache buster
    map.current.addSource('railway_routes', createRailwayRoutesSource({ cacheBuster: newCacheBuster }));

    // Re-add layer
    map.current.addLayer(createRailwayRoutesLayer());

    // Explicitly set visibility based on current state
    map.current.setLayoutProperty(
      'railway_routes',
      'visibility',
      showRoutesLayer ? 'visible' : 'none'
    );

    // Re-apply selected route highlighting if needed
    if (selectedRouteId) {
      map.current.setPaintProperty('railway_routes', 'line-color', [
        'case',
        ['==', ['get', 'track_id'], selectedRouteId],
        COLORS.railwayRoutes.selected, // Selected routes always orange
        ['==', ['get', 'is_valid'], false],
        COLORS.railwayRoutes.invalid, // Unselected invalid routes are grey
        COLORS.railwayRoutes.created
      ]);
      map.current.setPaintProperty('railway_routes', 'line-width', [
        'case',
        ['==', ['get', 'track_id'], selectedRouteId],
        5,
        ['==', ['get', 'usage_type'], 1],
        2, // Special routes = thinner
        3  // Normal routes = standard width
      ]);
      map.current.setPaintProperty('railway_routes', 'line-opacity', [
        'case',
        ['==', ['get', 'track_id'], selectedRouteId],
        1.0,
        0.8
      ]);
    } else {
      // Also apply invalid styling when no route is selected
      map.current.setPaintProperty('railway_routes', 'line-color', [
        'case',
        ['==', ['get', 'is_valid'], false],
        COLORS.railwayRoutes.invalid,
        COLORS.railwayRoutes.created
      ]);
      map.current.setPaintProperty('railway_routes', 'line-width', [
        'case',
        ['==', ['get', 'usage_type'], 1],
        2, // Special routes = thinner
        3  // Normal routes = standard width
      ]);
    }

    // Reapply parts styling
    if (updatePartsStyleRef.current) {
      setTimeout(() => {
        updatePartsStyleRef.current?.();
      }, 100);
    }

    // Force map repaint to clear any cached tiles
    map.current.triggerRepaint();
  }, [refreshTrigger, mapLoaded, showRoutesLayer, selectedRouteId, map]);

  // Handle preview route
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Remove existing preview layer if any
    if (map.current.getLayer('preview-route')) {
      map.current.removeLayer('preview-route');
    }
    if (map.current.getSource('preview-route')) {
      map.current.removeSource('preview-route');
    }

    if (previewRoute && previewRoute.coordinates && previewRoute.coordinates.length > 0) {
      console.log('[VectorAdminMap] Rendering preview route with', previewRoute.coordinates.length, 'coordinates');

      // Use the merged/truncated coordinates directly
      // This is what the pathfinder produces after merging and truncating
      const features = [{
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: previewRoute.coordinates
        },
        properties: {}
      }];

      console.log('[VectorAdminMap] Preview features:', features);

      // Add preview route as a GeoJSON source
      map.current.addSource('preview-route', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: features
        }
      });

      // Add preview layer on top of all other layers
      // Don't specify beforeId to add it as the topmost layer
      map.current.addLayer({
        'id': 'preview-route',
        'type': 'line',
        'source': 'preview-route',
        'layout': {
          'line-cap': 'round',
          'line-join': 'round'
        },
        'paint': {
          'line-color': COLORS.preview,
          'line-width': 8,
          'line-opacity': 1.0
        }
      });

      console.log('[VectorAdminMap] Preview route layer added successfully');

      // Optionally zoom to show the preview route
      if (previewRoute.coordinates.length > 0) {
        const lngs = previewRoute.coordinates.map(c => c[0]);
        const lats = previewRoute.coordinates.map(c => c[1]);
        const bounds: [[number, number], [number, number]] = [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)]
        ];

        // Fit bounds with padding to show the whole route
        map.current.fitBounds(bounds, {
          padding: 80,
          duration: 500,
          maxZoom: 14
        });
      }
    } else {
      console.log('[VectorAdminMap] No preview route to display');
    }

    // Update parts styling when preview changes
    if (updatePartsStyleRef.current) {
      requestAnimationFrame(() => {
        updatePartsStyleRef.current?.();
      });
    }
  }, [previewRoute, mapLoaded, map]);

  // Handle selected coordinate points visualization
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Remove existing selected points layers if any
    if (map.current.getLayer('selected-points')) {
      map.current.removeLayer('selected-points');
    }
    if (map.current.getSource('selected-points')) {
      map.current.removeSource('selected-points');
    }

    const features: Array<{
      type: 'Feature';
      geometry: { type: 'Point'; coordinates: [number, number] };
      properties: { type: string };
    }> = [];

    if (selectedCoordinates?.startingCoordinate) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: selectedCoordinates.startingCoordinate
        },
        properties: { type: 'start' }
      });
      console.log('[VectorAdminMap] Added start point:', selectedCoordinates.startingCoordinate);
    }

    if (selectedCoordinates?.endingCoordinate) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: selectedCoordinates.endingCoordinate
        },
        properties: { type: 'end' }
      });
      console.log('[VectorAdminMap] Added end point:', selectedCoordinates.endingCoordinate);
    }

    if (features.length > 0) {
      // Add selected points as a GeoJSON source
      map.current.addSource('selected-points', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: features
        }
      });

      // Add selected points layer
      map.current.addLayer({
        'id': 'selected-points',
        'type': 'circle',
        'source': 'selected-points',
        'paint': {
          'circle-radius': 8,
          'circle-color': [
            'case',
            ['==', ['get', 'type'], 'start'],
            '#16a34a', // Green for start point
            '#dc2626'  // Red for end point
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 1.0
        }
      });

      console.log('[VectorAdminMap] Selected points layer added with', features.length, 'points');
    }
  }, [selectedCoordinates, mapLoaded, map]);

  // Handle focus on route geometry (fly to route when selected)
  useEffect(() => {
    if (!map.current || !mapLoaded || !focusGeometry) return;

    try {
      // Parse the WKT geometry string (should be in format "LINESTRING(...)")
      const geojson = JSON.parse(focusGeometry);

      if (geojson && geojson.type === 'LineString' && geojson.coordinates) {
        const coordinates = geojson.coordinates as [number, number][];

        // Calculate bounds from coordinates
        const lngs = coordinates.map(coord => coord[0]);
        const lats = coordinates.map(coord => coord[1]);

        const bounds: [[number, number], [number, number]] = [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)]
        ];

        // Fly to the bounds with padding
        map.current.fitBounds(bounds, {
          padding: 80,
          duration: 1000,
          maxZoom: 13
        });
      }
    } catch (error) {
      console.error('Error parsing geometry for focus:', error);
    }
  }, [focusGeometry, mapLoaded, map]);

  return (
    <div className={`${className} relative`}>
      <div ref={mapContainer} className="w-full h-full" />

      {/* Layer Controls */}
      <div className="absolute top-4 left-4 bg-white p-3 rounded shadow-lg text-black z-10">
        <h3 className="font-bold mb-2">Layers</h3>
        <div className="space-y-2">
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={showPartsLayer}
              onChange={() => setShowPartsLayer(!showPartsLayer)}
              className="mr-2"
            />
            Railway Parts
          </label>
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={showRoutesLayer}
              onChange={() => setShowRoutesLayer(!showRoutesLayer)}
              className="mr-2"
            />
            Railway Routes
          </label>
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={showStationsLayer}
              onChange={() => setShowStationsLayer(!showStationsLayer)}
              className="mr-2"
            />
            Stations
          </label>
        </div>
      </div>

      {/* Route Length Display */}
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
