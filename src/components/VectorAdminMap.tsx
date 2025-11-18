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
  createRailwayPartSplitsSource,
  createRailwayPartSplitsLayer,
  createStationsSource,
  createStationsLayer,
  COLORS,
} from '@/lib/map';
import { setupAdminMapInteractions } from '@/lib/map/interactions/adminMapInteractions';

interface VectorAdminMapProps {
  className?: string;
  onPartClick?: (partId: string) => void;
  onRouteSelect?: (routeId: string) => void;
  selectedRouteId?: string | null;
  previewRoute?: { partIds: string[], coordinates: [number, number][], railwayParts?: RailwayPart[] } | null;
  selectedParts?: { startingId: string, endingId: string };
  refreshTrigger?: number;
  isEditingGeometry?: boolean;
  focusGeometry?: string | null;
  isSplittingMode?: boolean;
  splittingPartId?: string | null;
  onExitSplitMode?: () => void;
  onRefreshMap?: () => void;
  showError?: (message: string) => void;
  showSuccess?: (message: string) => void;
  onSplitSuccess?: (parentId: string) => void;
}

export default function VectorAdminMap({
  className = '',
  onPartClick,
  onRouteSelect,
  selectedRouteId,
  previewRoute,
  selectedParts,
  refreshTrigger,
  isEditingGeometry,
  focusGeometry,
  isSplittingMode,
  splittingPartId,
  onExitSplitMode,
  onRefreshMap,
  showError,
  showSuccess,
  onSplitSuccess,
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
  const onPartClickRef = useRef(onPartClick);
  const onRouteSelectRef = useRef(onRouteSelect);
  const selectedPartsRef = useRef(selectedParts);
  const previewRouteRef = useRef(previewRoute);
  const updatePartsStyleRef = useRef<(() => void) | null>(null);
  const isSplittingModeRef = useRef(isSplittingMode);
  const splittingPartIdRef = useRef(splittingPartId);
  const onExitSplitModeRef = useRef(onExitSplitMode);
  const onRefreshMapRef = useRef(onRefreshMap);
  const showErrorRef = useRef(showError);
  const showSuccessRef = useRef(showSuccess);
  const onSplitSuccessRef = useRef(onSplitSuccess);


  onPartClickRef.current = onPartClick;
  onRouteSelectRef.current = onRouteSelect;
  selectedPartsRef.current = selectedParts;
  previewRouteRef.current = previewRoute;
  isSplittingModeRef.current = isSplittingMode;
  splittingPartIdRef.current = splittingPartId;
  onExitSplitModeRef.current = onExitSplitMode;
  onRefreshMapRef.current = onRefreshMap;
  showErrorRef.current = showError;
  showSuccessRef.current = showSuccess;
  onSplitSuccessRef.current = onSplitSuccess;

  // Initialize map with shared hook
  const { map, mapLoaded } = useMapLibre(
    mapContainer,
    {
      sources: {
        railway_parts: createRailwayPartsSource(),
        railway_part_splits: createRailwayPartSplitsSource(),
        railway_routes: createRailwayRoutesSource({ cacheBuster: routesCacheBuster }),
        stations: createStationsSource(),
      },
      layers: [
        createRailwayPartsLayer(),
        createRailwayPartSplitsLayer(),
        createRailwayRoutesLayer(),
        createStationsLayer(),
      ],
      onLoad: (mapInstance) => {
        setupAdminMapInteractions(mapInstance, {
          onPartClickRef,
          onRouteSelectRef,
          selectedPartsRef,
          previewRouteRef,
          updatePartsStyleRef,
          isSplittingModeRef,
          splittingPartIdRef,
          showErrorRef,
          showSuccessRef,
          onExitSplitModeRef,
          onRefreshMapRef,
          onSplitSuccessRef,
        });
      },
    },
    [] // Only initialize once
  );

  // Update parts styling when selectedParts or splitting mode changes
  useEffect(() => {
    if (map.current && mapLoaded && updatePartsStyleRef.current) {
      requestAnimationFrame(() => {
        updatePartsStyleRef.current?.();
      });
    }
  }, [selectedParts?.startingId, selectedParts?.endingId, isSplittingMode, splittingPartId, mapLoaded, map]);

  // Handle layer visibility toggles
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    map.current.setLayoutProperty(
      'railway_parts',
      'visibility',
      showPartsLayer ? 'visible' : 'none'
    );
    if (map.current.getLayer('railway_part_splits')) {
      map.current.setLayoutProperty(
        'railway_part_splits',
        'visibility',
        showPartsLayer ? 'visible' : 'none'
      );
    }
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

  // Handle railway routes and parts refresh when routes/parts are saved/deleted/split
  useEffect(() => {
    if (!map.current || !mapLoaded || refreshTrigger === undefined) return;
    if (refreshTrigger === 0) return; // Skip initial render

    console.log('Refreshing railway tiles...');

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

    // Re-apply visibility
    if (!showRoutesLayer) {
      map.current.setLayoutProperty('railway_routes', 'visibility', 'none');
    }

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

    // Also reload railway_parts tiles to show newly split parts
    const hasPartsLayer = map.current.getLayer('railway_parts');
    const hasPartsSource = map.current.getSource('railway_parts');

    if (hasPartsLayer) {
      map.current.removeLayer('railway_parts');
    }
    if (hasPartsSource) {
      map.current.removeSource('railway_parts');
    }

    // Re-add source with cache buster
    map.current.addSource('railway_parts', {
      ...createRailwayPartsSource(),
      tiles: createRailwayPartsSource().tiles?.map(url => `${url}?t=${newCacheBuster}`)
    });

    // Re-add layer
    map.current.addLayer(createRailwayPartsLayer());

    // Re-apply visibility
    if (!showPartsLayer) {
      map.current.setLayoutProperty('railway_parts', 'visibility', 'none');
    }

    // Also reload railway_part_splits tiles to show newly split parts
    const hasSplitsLayer = map.current.getLayer('railway_part_splits');
    const hasSplitsSource = map.current.getSource('railway_part_splits');

    if (hasSplitsLayer) {
      map.current.removeLayer('railway_part_splits');
    }
    if (hasSplitsSource) {
      map.current.removeSource('railway_part_splits');
    }

    // Re-add source with cache buster
    map.current.addSource('railway_part_splits', {
      ...createRailwayPartSplitsSource(),
      tiles: createRailwayPartSplitsSource().tiles?.map(url => `${url}?t=${newCacheBuster}`)
    });

    // Re-add layer (must be added after railway_parts but before railway_routes)
    map.current.addLayer(createRailwayPartSplitsLayer(), 'railway_routes');

    // Re-apply visibility
    if (!showPartsLayer) {
      map.current.setLayoutProperty('railway_part_splits', 'visibility', 'none');
    }

    // Reapply parts styling
    if (updatePartsStyleRef.current) {
      setTimeout(() => {
        updatePartsStyleRef.current?.();
      }, 100);
    }

    // Force map repaint to clear any cached tiles
    map.current.triggerRepaint();

    console.log('Railway tiles refreshed');
  }, [refreshTrigger, mapLoaded, showRoutesLayer, showPartsLayer, selectedRouteId, map]);

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
      // Build a FeatureCollection from railway parts
      const features: Array<{
        type: 'Feature';
        geometry: { type: 'LineString'; coordinates: [number, number][] };
        properties: Record<string, never>;
      }> = [];

      // If we have railwayParts, use their actual geometries
      if (previewRoute.railwayParts && previewRoute.railwayParts.length > 0) {
        previewRoute.railwayParts.forEach((part: RailwayPart) => {
          if (part.geometry && part.geometry.type === 'LineString') {
            features.push({
              type: 'Feature',
              geometry: part.geometry,
              properties: {}
            });
          }
        });
      } else {
        // Fallback to simple LineString
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: previewRoute.coordinates
          },
          properties: {}
        });
      }

      // Add preview route as a GeoJSON source
      map.current.addSource('preview-route', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: features
        }
      });

      // Add preview layer
      map.current.addLayer({
        'id': 'preview-route',
        'type': 'line',
        'source': 'preview-route',
        'paint': {
          'line-color': COLORS.preview,
          'line-width': 8,
          'line-opacity': 1.0
        }
      });
    }

    // Update parts styling when preview changes
    if (updatePartsStyleRef.current) {
      requestAnimationFrame(() => {
        updatePartsStyleRef.current?.();
      });
    }
  }, [previewRoute, mapLoaded, map]);

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
