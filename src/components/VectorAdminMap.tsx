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
}

export default function VectorAdminMap({
  className = '',
  onPartClick,
  onRouteSelect,
  selectedRouteId,
  previewRoute,
  selectedParts,
  refreshTrigger,
  isEditingGeometry
}: VectorAdminMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [showPartsLayer, setShowPartsLayer] = useState(true);
  const [showRoutesLayer, setShowRoutesLayer] = useState(true);
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

  useEffect(() => {
    onPartClickRef.current = onPartClick;
    onRouteSelectRef.current = onRouteSelect;
    selectedPartsRef.current = selectedParts;
    previewRouteRef.current = previewRoute;
  }, [onPartClick, onRouteSelect, selectedParts, previewRoute]);

  // Initialize map with shared hook
  const { map, mapLoaded } = useMapLibre(
    mapContainer,
    {
      sources: {
        railway_parts: createRailwayPartsSource(),
        railway_routes: createRailwayRoutesSource({ cacheBuster: routesCacheBuster }),
      },
      layers: [
        createRailwayPartsLayer(),
        createRailwayRoutesLayer(),
      ],
      onLoad: (mapInstance) => {
        setupAdminMapInteractions(mapInstance, {
          onPartClickRef,
          onRouteSelectRef,
          selectedPartsRef,
          previewRouteRef,
          updatePartsStyleRef,
        });
      },
    },
    [] // Only initialize once
  );

  // Update parts styling when selectedParts changes
  useEffect(() => {
    if (map.current && mapLoaded && updatePartsStyleRef.current) {
      requestAnimationFrame(() => {
        updatePartsStyleRef.current?.();
      });
    }
  }, [selectedParts?.startingId, selectedParts?.endingId, mapLoaded, map]);

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
        COLORS.railwayRoutes.default
      ]);
      map.current.setPaintProperty('railway_routes', 'line-width', [
        'case',
        ['==', ['get', 'track_id'], selectedRouteId],
        5,
        3
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
        COLORS.railwayRoutes.default
      ]);
      map.current.setPaintProperty('railway_routes', 'line-width', 3);
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
        COLORS.railwayRoutes.default
      ]);
      map.current.setPaintProperty('railway_routes', 'line-width', [
        'case',
        ['==', ['get', 'track_id'], selectedRouteId],
        5,
        3
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
        COLORS.railwayRoutes.default
      ]);
    }
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
