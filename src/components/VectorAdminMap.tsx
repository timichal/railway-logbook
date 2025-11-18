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
  onPartClick?: (partId: string) => void;
  onRouteSelect?: (routeId: string) => void;
  selectedRouteId?: string | null;
  previewRoute?: { partIds: string[], coordinates: [number, number][], railwayParts?: RailwayPart[] } | null;
  selectedParts?: { startingId: string, endingId: string };
  refreshTrigger?: number;
  isEditingGeometry?: boolean;
  focusGeometry?: string | null;
  isSplitMode?: boolean;
  splittingPartId?: string | null;
  viewingSegmentsForPart?: string | null;
  onSplitPointClick?: (lng: number, lat: number) => void;
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
  isSplitMode,
  splittingPartId,
  viewingSegmentsForPart,
  onSplitPointClick
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
  const onSplitPointClickRef = useRef(onSplitPointClick);
  const selectedPartsRef = useRef(selectedParts);
  const previewRouteRef = useRef(previewRoute);
  const updatePartsStyleRef = useRef<(() => void) | null>(null);
  const splitModeRef = useRef(isSplitMode || false);
  const splittingPartIdRef = useRef(splittingPartId);

  useEffect(() => {
    onPartClickRef.current = onPartClick;
    onRouteSelectRef.current = onRouteSelect;
    onSplitPointClickRef.current = onSplitPointClick;
    selectedPartsRef.current = selectedParts;
    previewRouteRef.current = previewRoute;
    splitModeRef.current = isSplitMode || false;
    splittingPartIdRef.current = splittingPartId;
  }, [onPartClick, onRouteSelect, onSplitPointClick, selectedParts, previewRoute, isSplitMode, splittingPartId]);

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
          onPartClickRef,
          onRouteSelectRef,
          onSplitPointClickRef,
          selectedPartsRef,
          previewRouteRef,
          updatePartsStyleRef,
          splitModeRef,
          splittingPartIdRef,
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

  // Update parts styling when split mode or splitting part changes
  useEffect(() => {
    if (map.current && mapLoaded && updatePartsStyleRef.current) {
      requestAnimationFrame(() => {
        updatePartsStyleRef.current?.();
      });
    }
  }, [isSplitMode, splittingPartId, mapLoaded, map]);

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

  // Handle split segments display
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    async function loadSplitSegments() {
      try {
        const { getSplitSegmentsGeoJSON, getSplitPartIds } = await import('@/lib/railwayPartSplitsActions');
        const [segmentsData, splitPartIds] = await Promise.all([
          getSplitSegmentsGeoJSON(),
          getSplitPartIds()
        ]);

        if (!map.current) return;

        // Remove existing layer and source
        if (map.current.getLayer('split-segments')) {
          map.current.removeLayer('split-segments');
        }
        if (map.current.getSource('split-segments')) {
          map.current.removeSource('split-segments');
        }

        // Don't hide split parts - keep them visible in blue
        // Segments will be shown separately when needed
        map.current.setFilter('railway_parts', null);

        // Only add if there are segments
        if (segmentsData.features.length > 0) {
          // Add source
          map.current.addSource('split-segments', {
            type: 'geojson',
            data: segmentsData
          });

          // Build filter to show segments only when:
          // 1. The part is currently being split (splittingPartId), OR
          // 2. A segment from that part is selected in starting/ending field

          // Extract original part IDs from segment IDs
          const extractOriginalPartId = (partId: string): string => {
            const match = partId.match(/^(\d+)_seg[01]$/);
            return match ? match[1] : partId;
          };

          const visiblePartIds: number[] = [];

          // Add part being split
          if (splittingPartId) {
            visiblePartIds.push(parseInt(splittingPartId));
          }

          // Add part being viewed for segment selection
          if (viewingSegmentsForPart) {
            visiblePartIds.push(parseInt(viewingSegmentsForPart));
          }

          // Add parts that are selected in fields and are segments
          if (selectedParts?.startingId && selectedParts.startingId.includes('_seg')) {
            const originalId = extractOriginalPartId(selectedParts.startingId);
            visiblePartIds.push(parseInt(originalId));
          }
          if (selectedParts?.endingId && selectedParts.endingId.includes('_seg')) {
            const originalId = extractOriginalPartId(selectedParts.endingId);
            visiblePartIds.push(parseInt(originalId));
          }

          // Create filter expression
          let filter: any[] | null = null;
          if (visiblePartIds.length > 0) {
            // Remove duplicates
            const uniquePartIds = Array.from(new Set(visiblePartIds));
            filter = ['in', ['to-number', ['get', 'part_id']], ['literal', uniquePartIds]];
          } else {
            // No parts to show - hide all segments
            filter = ['==', ['get', 'part_id'], ''];
          }

          // Add layer with distinct colors for each segment
          map.current.addLayer({
            'id': 'split-segments',
            'type': 'line',
            'source': 'split-segments',
            'filter': filter,
            'paint': {
              'line-color': [
                'case',
                ['==', ['get', 'segment_index'], 0],
                '#10B981', // Green-500 for seg0
                '#3B82F6'  // Blue-500 for seg1
              ],
              'line-width': 5,
              'line-opacity': 0.9
            }
          }, 'railway_parts'); // Insert before railway_parts so parts appear on top
        }
      } catch (error) {
        console.error('Error loading split segments:', error);
      }
    }

    loadSplitSegments();
  }, [mapLoaded, refreshTrigger, map]);

  // Update split-segments filter and styling when dependencies change
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const layer = map.current.getLayer('split-segments');
    if (!layer) return;

    // Extract original part IDs from segment IDs
    const extractOriginalPartId = (partId: string): string => {
      const match = partId.match(/^(\d+)_seg[01]$/);
      return match ? match[1] : partId;
    };

    const visiblePartIds: number[] = [];

    // Add part being split
    if (splittingPartId) {
      visiblePartIds.push(parseInt(splittingPartId));
    }

    // Add part being viewed for segment selection
    if (viewingSegmentsForPart) {
      visiblePartIds.push(parseInt(viewingSegmentsForPart));
    }

    // Add parts that are selected in fields and are segments
    if (selectedParts?.startingId && selectedParts.startingId.includes('_seg')) {
      const originalId = extractOriginalPartId(selectedParts.startingId);
      visiblePartIds.push(parseInt(originalId));
    }
    if (selectedParts?.endingId && selectedParts.endingId.includes('_seg')) {
      const originalId = extractOriginalPartId(selectedParts.endingId);
      visiblePartIds.push(parseInt(originalId));
    }

    // Create filter expression
    let filter: any[] | null = null;
    if (visiblePartIds.length > 0) {
      // Remove duplicates
      const uniquePartIds = Array.from(new Set(visiblePartIds));
      filter = ['in', ['to-number', ['get', 'part_id']], ['literal', uniquePartIds]];
    } else {
      // No parts to show - hide all segments
      filter = ['==', ['get', 'part_id'], ''];
    }

    map.current.setFilter('split-segments', filter);

    // Update paint properties to highlight selected segments
    // Build color expression: green for starting segment, orange for ending segment
    const hasSelectedSegments =
      (selectedParts?.startingId && selectedParts.startingId.includes('_seg')) ||
      (selectedParts?.endingId && selectedParts.endingId.includes('_seg'));

    let colorExpr: any;
    if (hasSelectedSegments) {
      const expr: any[] = ['case'];

      // Check if segment_id matches startingId (which might be a segment ID)
      if (selectedParts?.startingId && selectedParts.startingId.includes('_seg')) {
        expr.push(['==', ['get', 'segment_id'], selectedParts.startingId], '#059669'); // Green for starting
      }

      // Check if segment_id matches endingId (which might be a segment ID)
      if (selectedParts?.endingId && selectedParts.endingId.includes('_seg')) {
        expr.push(['==', ['get', 'segment_id'], selectedParts.endingId], '#F97316'); // Orange for ending
      }

      // Default colors based on segment index
      expr.push(
        ['case',
          ['==', ['get', 'segment_index'], 0],
          '#10B981', // Green-500 for seg0
          '#3B82F6'  // Blue-500 for seg1
        ]
      );

      colorExpr = expr;
    } else {
      // No selected segments - use default colors
      colorExpr = [
        'case',
        ['==', ['get', 'segment_index'], 0],
        '#10B981', // Green-500 for seg0
        '#3B82F6'  // Blue-500 for seg1
      ];
    }

    map.current.setPaintProperty('split-segments', 'line-color', colorExpr);

    // Build width expression: thicker for selected segments
    let widthExpr: any;
    if (hasSelectedSegments) {
      const expr: any[] = ['case'];

      if (selectedParts?.startingId && selectedParts.startingId.includes('_seg')) {
        expr.push(['==', ['get', 'segment_id'], selectedParts.startingId], 7);
      }
      if (selectedParts?.endingId && selectedParts.endingId.includes('_seg')) {
        expr.push(['==', ['get', 'segment_id'], selectedParts.endingId], 7);
      }

      expr.push(5); // Default width
      widthExpr = expr;
    } else {
      // No selected segments - use default width
      widthExpr = 5;
    }

    map.current.setPaintProperty('split-segments', 'line-width', widthExpr);

  }, [selectedParts?.startingId, selectedParts?.endingId, splittingPartId, viewingSegmentsForPart, mapLoaded, map]);

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
