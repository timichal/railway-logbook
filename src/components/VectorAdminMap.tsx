'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { RailwayPart } from '@/lib/types';

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
  const map = useRef<maplibregl.Map | null>(null);
  const [showPartsLayer, setShowPartsLayer] = useState(true);
  const [showRoutesLayer, setShowRoutesLayer] = useState(true);
  const [mapLoaded, setMapLoaded] = useState(false);
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

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    // Create map instance
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'osm': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          },
          'railway_parts': {
            type: 'vector',
            tiles: [`${window.location.protocol}//${window.location.hostname}:3001/railway_parts_tile/{z}/{x}/{y}`],
            minzoom: 0,
            maxzoom: 14
          },
          'railway_routes': {
            type: 'vector',
            tiles: [`${window.location.protocol}//${window.location.hostname}:3001/railway_routes_tile/{z}/{x}/{y}?v=${routesCacheBuster}`],
            minzoom: 7,
            maxzoom: 14
          }
        },
        layers: [
          {
            'id': 'background',
            'type': 'raster',
            'source': 'osm',
            'minzoom': 0,
            'maxzoom': 22
          },
          {
            'id': 'railway_parts',
            'type': 'line',
            'source': 'railway_parts',
            'source-layer': 'railway_parts',
            'minzoom': 0,
            'layout': {
              'visibility': 'visible'
            },
            'paint': {
              'line-color': '#2563eb',  // Blue (default parts color)
              'line-width': 3,  // Thicker default width
              'line-opacity': 0.7
            }
          },
          {
            'id': 'railway_routes',
            'type': 'line',
            'source': 'railway_routes',
            'source-layer': 'railway_routes',
            'minzoom': 7,
            'layout': {
              'visibility': 'visible'
            },
            'paint': {
              'line-color': '#dc2626',  // Red (default routes color)
              'line-width': 3,
              'line-opacity': 0.8
            }
          }
        ]
      },
      center: [14.5, 49.2], // Czech Republic/Austria border region
      zoom: 7
    });

    // Add navigation controls
    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Wait for style to load before adding interactions
    map.current.on('load', () => {
      setMapLoaded(true);
    });

    // Add click handler for railway parts
    map.current.on('click', 'railway_parts', (e) => {
      if (!e.features || e.features.length === 0) return;

      // Don't handle part clicks if we also clicked on a route
      const routeFeatures = map.current!.queryRenderedFeatures(e.point, {
        layers: ['railway_routes']
      });
      if (routeFeatures && routeFeatures.length > 0) {
        // A route was clicked, don't select the part underneath
        return;
      }

      const feature = e.features[0];
      const properties = feature.properties;

      if (!properties || !onPartClickRef.current) return;

      const partId = properties.id.toString();
      onPartClickRef.current(partId);

      // No popup - just highlight the part (handled by updatePartsStyle)
    });

    // Add click handler for railway routes
    map.current.on('click', 'railway_routes', (e) => {
      if (!e.features || e.features.length === 0) return;
      const feature = e.features[0];
      const properties = feature.properties;

      if (!properties || !onRouteSelectRef.current) return;

      const trackId = properties.track_id;
      onRouteSelectRef.current(trackId);

      // No popup - details shown in sidebar Railway Routes tab
    });

    // Add hover effects for railway parts
    let hoveredPartId: string | null = null;

    map.current.on('mouseenter', 'railway_parts', (e) => {
      if (map.current && e.features && e.features.length > 0) {
        map.current.getCanvas().style.cursor = 'pointer';
        hoveredPartId = e.features[0].properties?.id?.toString() || null;
        updatePartsStyle();
      }
    });

    map.current.on('mouseleave', 'railway_parts', () => {
      if (map.current) {
        map.current.getCanvas().style.cursor = '';
        hoveredPartId = null;
        updatePartsStyle();
      }
    });

    // Function to update parts styling based on selection and hover state
    const updatePartsStyle = () => {
      if (!map.current) return;

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
          expr.push(['==', ['get', 'id'], hoveredPartId], '#dc2626');
        }

        // Starting part (green)
        if (startingId) {
          expr.push(['==', ['get', 'id'], parseInt(startingId)], '#16a34a');
        }

        // Ending part (red)
        if (endingId) {
          expr.push(['==', ['get', 'id'], parseInt(endingId)], '#dc2626');
        }

        // Default blue
        expr.push('#2563eb');
        colorExpr = expr;
      } else {
        colorExpr = '#2563eb'; // Simple default value when no conditions
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

        expr.push(3); // Default (thicker)
        weightExpr = expr;
      } else {
        weightExpr = 3; // Simple default value when no conditions (thicker)
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
        opacityExpr = 0.7; // Simple default value when no conditions
      }

      map.current.setPaintProperty('railway_parts', 'line-color', colorExpr);
      map.current.setPaintProperty('railway_parts', 'line-width', weightExpr);
      map.current.setPaintProperty('railway_parts', 'line-opacity', opacityExpr);
    };

    // Add hover effects for railway routes with popup
    let routeHoverPopup: maplibregl.Popup | null = null;

    map.current.on('mouseenter', 'railway_routes', (e) => {
      if (!map.current) return;

      map.current.getCanvas().style.cursor = 'pointer';

      // Get route properties
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const properties = feature.properties;

        if (properties) {
          const trackId = properties.track_id;

          // Remove existing popup if any
          if (routeHoverPopup) {
            routeHoverPopup.remove();
          }

          // Create hover popup
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
            .addTo(map.current);
        }
      }
    });

    map.current.on('mouseleave', 'railway_routes', () => {
      if (map.current) {
        map.current.getCanvas().style.cursor = '';
      }

      // Remove hover popup
      if (routeHoverPopup) {
        routeHoverPopup.remove();
        routeHoverPopup = null;
      }
    });

    // Store updatePartsStyle in ref to be called when selectedParts changes
    updatePartsStyleRef.current = updatePartsStyle;

    // Cleanup on unmount
    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  // Note: routesCacheBuster is used in map initialization but should not be a dependency
  // as we only want this effect to run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Update parts styling when selectedParts changes
  useEffect(() => {
    if (map.current && mapLoaded && updatePartsStyleRef.current) {
      // Use requestAnimationFrame to defer the update and avoid blocking
      requestAnimationFrame(() => {
        updatePartsStyleRef.current?.();
      });
    }
  }, [selectedParts?.startingId, selectedParts?.endingId, mapLoaded]);

  // Handle layer visibility toggles
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    map.current.setLayoutProperty(
      'railway_parts',
      'visibility',
      showPartsLayer ? 'visible' : 'none'
    );
  }, [showPartsLayer, mapLoaded]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    map.current.setLayoutProperty(
      'railway_routes',
      'visibility',
      showRoutesLayer ? 'visible' : 'none'
    );
  }, [showRoutesLayer, mapLoaded]);

  // Handle selected route highlighting
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    if (selectedRouteId) {
      map.current.setPaintProperty('railway_routes', 'line-color', [
        'case',
        ['==', ['get', 'track_id'], selectedRouteId],
        '#ff6b35',  // Orange for selected route
        '#dc2626'   // Red for default routes
      ]);
      map.current.setPaintProperty('railway_routes', 'line-width', [
        'case',
        ['==', ['get', 'track_id'], selectedRouteId],
        5,  // Thicker for selected route
        3
      ]);
      map.current.setPaintProperty('railway_routes', 'line-opacity', [
        'case',
        ['==', ['get', 'track_id'], selectedRouteId],
        1.0,  // Full opacity for selected
        0.8
      ]);
    } else {
      map.current.setPaintProperty('railway_routes', 'line-color', '#dc2626');
      map.current.setPaintProperty('railway_routes', 'line-width', 3);
      map.current.setPaintProperty('railway_routes', 'line-opacity', 0.8);
    }
  }, [selectedRouteId, mapLoaded]);

  // Handle railway routes refresh when routes are saved/deleted
  useEffect(() => {
    if (!map.current || !mapLoaded || refreshTrigger === undefined) return;

    // Skip initial render (refreshTrigger = 0)
    if (refreshTrigger === 0) return;

    // Update cache buster to force tile reload
    const newCacheBuster = Date.now();
    setRoutesCacheBuster(newCacheBuster);

    // Reload railway_routes tiles by removing and re-adding source
    const hasRoutesLayer = map.current.getLayer('railway_routes');
    const hasRoutesSource = map.current.getSource('railway_routes');

    if (hasRoutesLayer) {
      map.current.removeLayer('railway_routes');
    }
    if (hasRoutesSource) {
      map.current.removeSource('railway_routes');
    }

    // Re-add source with new cache buster
    map.current.addSource('railway_routes', {
      type: 'vector',
      tiles: [`${window.location.protocol}//${window.location.hostname}:3001/railway_routes_tile/{z}/{x}/{y}?v=${newCacheBuster}`],
      minzoom: 7,
      maxzoom: 14
    });

    // Re-add layer
    map.current.addLayer({
      'id': 'railway_routes',
      'type': 'line',
      'source': 'railway_routes',
      'source-layer': 'railway_routes',
      'minzoom': 7,
      'layout': {
        'visibility': showRoutesLayer ? 'visible' : 'none'
      },
      'paint': {
        'line-color': '#dc2626',  // Red (default routes color)
        'line-width': 3,
        'line-opacity': 0.8
      }
    });

    // Re-apply selected route highlighting if needed
    if (selectedRouteId) {
      map.current.setPaintProperty('railway_routes', 'line-color', [
        'case',
        ['==', ['get', 'track_id'], selectedRouteId],
        '#ff6b35',  // Orange for selected route
        '#dc2626'   // Red for default routes
      ]);
      map.current.setPaintProperty('railway_routes', 'line-width', [
        'case',
        ['==', ['get', 'track_id'], selectedRouteId],
        5,  // Thicker for selected route
        3
      ]);
      map.current.setPaintProperty('railway_routes', 'line-opacity', [
        'case',
        ['==', ['get', 'track_id'], selectedRouteId],
        1.0,  // Full opacity for selected
        0.8
      ]);
    }
  }, [refreshTrigger, mapLoaded, showRoutesLayer, selectedRouteId]);

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
      // Build a FeatureCollection from all railway parts to show actual track geometry
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
        // Fallback to simple LineString if no railway parts
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

      // Add preview layer on top of all other layers
      map.current.addLayer({
        'id': 'preview-route',
        'type': 'line',
        'source': 'preview-route',
        'paint': {
          'line-color': '#ff6600',  // Orange preview color
          'line-width': 8,  // Thicker to cover underlying parts
          'line-opacity': 1.0  // Full opacity, solid line
        }
      });

      // Fit map to preview route bounds
      const coordinates = previewRoute.coordinates;
      const bounds = coordinates.reduce((bounds, coord) => {
        return bounds.extend(coord as [number, number]);
      }, new maplibregl.LngLatBounds(coordinates[0] as [number, number], coordinates[0] as [number, number]));

      map.current.fitBounds(bounds, {
        padding: 50
      });
    }

    // Update parts styling when preview changes
    if (updatePartsStyleRef.current) {
      requestAnimationFrame(() => {
        updatePartsStyleRef.current?.();
      });
    }
  }, [previewRoute, mapLoaded]);

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
