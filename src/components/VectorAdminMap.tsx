'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { RailwayPart } from '@/lib/types';
import { useMapLibre } from '@/lib/map/hooks/useMapLibre';
import {
  createRailwayRoutesSource,
  createRailwayRoutesLayer,
  createRailwayPartsSource,
  createRailwayPartsLayer,
  COLORS,
} from '@/lib/map';

interface VectorAdminMapProps {
  className?: string;
  onPartClick?: (partId: string) => void;
  onRouteSelect?: (routeId: string) => void;
  selectedRouteId?: string | null;
  previewRoute?: { partIds: string[], coordinates: [number, number][], railwayParts?: RailwayPart[] } | null;
  selectedParts?: { startingId: string, endingId: string };
  refreshTrigger?: number;
}

export default function VectorAdminMap({
  className = '',
  onPartClick,
  onRouteSelect,
  selectedRouteId,
  previewRoute,
  selectedParts,
  refreshTrigger
}: VectorAdminMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [showPartsLayer, setShowPartsLayer] = useState(true);
  const [showRoutesLayer, setShowRoutesLayer] = useState(true);
  const [routesCacheBuster, setRoutesCacheBuster] = useState(Date.now());

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
        setupMapInteractions(mapInstance);
      },
    },
    [] // Only initialize once
  );

  // Setup all map interactions
  function setupMapInteractions(mapInstance: maplibregl.Map) {
    // Click handler for railway parts
    mapInstance.on('click', 'railway_parts', (e) => {
      if (!e.features || e.features.length === 0) return;

      // Don't handle part clicks if we also clicked on a route
      const routeFeatures = mapInstance.queryRenderedFeatures(e.point, {
        layers: ['railway_routes']
      });
      if (routeFeatures && routeFeatures.length > 0) {
        return;
      }

      const feature = e.features[0];
      const properties = feature.properties;

      if (!properties || !onPartClickRef.current) return;

      const partId = properties.id.toString();
      onPartClickRef.current(partId);
    });

    // Click handler for railway routes
    mapInstance.on('click', 'railway_routes', (e) => {
      if (!e.features || e.features.length === 0) return;
      const feature = e.features[0];
      const properties = feature.properties;

      if (!properties || !onRouteSelectRef.current) return;

      const trackId = properties.track_id;
      onRouteSelectRef.current(trackId);
    });

    // Hover effects for railway parts
    let hoveredPartId: string | null = null;

    mapInstance.on('mouseenter', 'railway_parts', (e) => {
      mapInstance.getCanvas().style.cursor = 'pointer';
      hoveredPartId = e.features?.[0]?.properties?.id?.toString() || null;
      updatePartsStyle();
    });

    mapInstance.on('mouseleave', 'railway_parts', () => {
      mapInstance.getCanvas().style.cursor = '';
      hoveredPartId = null;
      updatePartsStyle();
    });

    // Function to update parts styling based on selection and hover state
    const updatePartsStyle = () => {
      // Don't apply selection styling when preview is active
      const isPreviewActive = previewRouteRef.current !== null;

      const selectedParts = selectedPartsRef.current;
      const startingId = selectedParts?.startingId;
      const endingId = selectedParts?.endingId;

      const hasAnyCondition = !isPreviewActive && !!(hoveredPartId || startingId || endingId);

      // Build color expression
      type MapLibreExpression = string | number | unknown[];
      let colorExpr: MapLibreExpression;
      if (hasAnyCondition) {
        const expr: unknown[] = ['case'];

        // Hover state (highest priority)
        if (hoveredPartId) {
          expr.push(['==', ['get', 'id'], hoveredPartId], COLORS.railwayParts.hover);
        }

        // Starting part (green)
        if (startingId) {
          expr.push(['==', ['get', 'id'], parseInt(startingId)], COLORS.railwayParts.selected);
        }

        // Ending part (red)
        if (endingId) {
          expr.push(['==', ['get', 'id'], parseInt(endingId)], COLORS.railwayParts.hover);
        }

        // Default blue
        expr.push(COLORS.railwayParts.default);
        colorExpr = expr;
      } else {
        colorExpr = COLORS.railwayParts.default;
      }

      // Build weight expression
      let weightExpr: MapLibreExpression;
      if (hasAnyCondition) {
        const expr: unknown[] = ['case'];

        if (startingId) {
          expr.push(['==', ['get', 'id'], parseInt(startingId)], 6);
        }
        if (endingId) {
          expr.push(['==', ['get', 'id'], parseInt(endingId)], 6);
        }
        if (hoveredPartId) {
          expr.push(['==', ['get', 'id'], hoveredPartId], 4);
        }

        expr.push(3); // Default
        weightExpr = expr;
      } else {
        weightExpr = 3;
      }

      // Build opacity expression
      let opacityExpr: MapLibreExpression;
      if (startingId || endingId) {
        const expr: unknown[] = ['case'];

        if (startingId) {
          expr.push(['==', ['get', 'id'], parseInt(startingId)], 1.0);
        }
        if (endingId) {
          expr.push(['==', ['get', 'id'], parseInt(endingId)], 1.0);
        }

        expr.push(0.7); // Default
        opacityExpr = expr;
      } else {
        opacityExpr = 0.7;
      }

      mapInstance.setPaintProperty('railway_parts', 'line-color', colorExpr);
      mapInstance.setPaintProperty('railway_parts', 'line-width', weightExpr);
      mapInstance.setPaintProperty('railway_parts', 'line-opacity', opacityExpr);
    };

    // Hover effects for railway routes with popup
    let routeHoverPopup: maplibregl.Popup | null = null;

    mapInstance.on('mouseenter', 'railway_routes', (e) => {
      mapInstance.getCanvas().style.cursor = 'pointer';

      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const properties = feature.properties;

        if (properties) {
          const trackId = properties.track_id;

          if (routeHoverPopup) {
            routeHoverPopup.remove();
          }

          routeHoverPopup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 10,
            className: 'railway-route-hover-popup'
          })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="color: black;">
                <h3 style="font-weight: bold; margin-bottom: 4px;">${properties.name || 'Unnamed Route'}</h3>
                <p style="margin: 2px 0;">Track ID: ${trackId}</p>
                ${properties.description ? `<p style="margin: 2px 0;">${properties.description}</p>` : ''}
                <p style="margin: 2px 0;">Operator: ${properties.primary_operator}</p>
              </div>
            `)
            .addTo(mapInstance);
        }
      }
    });

    mapInstance.on('mouseleave', 'railway_routes', () => {
      mapInstance.getCanvas().style.cursor = '';

      if (routeHoverPopup) {
        routeHoverPopup.remove();
        routeHoverPopup = null;
      }
    });

    // Store updatePartsStyle in ref
    updatePartsStyleRef.current = updatePartsStyle;
  }

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

  // Handle selected route highlighting
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    if (selectedRouteId) {
      map.current.setPaintProperty('railway_routes', 'line-color', [
        'case',
        ['==', ['get', 'track_id'], selectedRouteId],
        COLORS.railwayRoutes.selected,
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
      map.current.setPaintProperty('railway_routes', 'line-color', COLORS.railwayRoutes.default);
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
        COLORS.railwayRoutes.selected,
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
    </div>
  );
}
