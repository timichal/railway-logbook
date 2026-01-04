'use client';

import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl from 'maplibre-gl';
import type { RailwayPart, GeoJSONFeatureCollection } from '@/lib/types';
import { useMapLibre } from '@/lib/map/hooks/useMapLibre';
import { useRouteLength } from '@/lib/map/hooks/useRouteLength';
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
import { getAdminNote } from '@/lib/adminNotesActions';
import NotesPopup from './NotesPopup';

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
  const [showPartsLayer, setShowPartsLayer] = useState(true);
  const [showRoutesLayer, setShowRoutesLayer] = useState(true);
  const [showStationsLayer, setShowStationsLayer] = useState(true);
  const [showEndpointsLayer, setShowEndpointsLayer] = useState(true);
  const [showNotesLayer, setShowNotesLayer] = useState(true);
  const [routesCacheBuster, setRoutesCacheBuster] = useState(Date.now());
  const [notesCacheBuster, setNotesCacheBuster] = useState(Date.now());
  const [routeEndpoints, setRouteEndpoints] = useState<GeoJSONFeatureCollection | null>(null);
  const previousShowRoutesLayerRef = useRef(true); // Track previous state before editing geometry
  const notesPopupRef = useRef<maplibregl.Popup | null>(null);

  // Use custom hook for route length management
  const { previewLength, selectedRouteLength } = useRouteLength(previewRoute, selectedRouteId);

  // Store callbacks in refs to avoid map recreation on changes
  const onCoordinateClickRef = useRef(onCoordinateClick);
  const onRouteSelectRef = useRef(onRouteSelect);

  onCoordinateClickRef.current = onCoordinateClick;
  onRouteSelectRef.current = onRouteSelect;

  // Initialize map with shared hook
  const { map, mapLoaded } = useMapLibre(
    mapContainer,
    {
      sources: {
        railway_parts: createRailwayPartsSource(),
        railway_routes: createRailwayRoutesSource({ cacheBuster: routesCacheBuster }),
        stations: createStationsSource(),
        admin_notes: createAdminNotesSource(notesCacheBuster),
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
    [] // Only initialize once
  );

  // Fetch route endpoints when map loads or routes are updated
  useEffect(() => {
    const fetchEndpoints = async () => {
      try {
        const endpoints = await getAllRouteEndpoints();
        setRouteEndpoints(endpoints);
      } catch (error) {
        console.error('Error fetching route endpoints:', error);
      }
    };

    if (mapLoaded) {
      fetchEndpoints();
    }
  }, [mapLoaded, refreshTrigger]);

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

    // Toggle both railway routes and scenic outline layers together
    const visibility = showRoutesLayer ? 'visible' : 'none';
    map.current.setLayoutProperty('railway_routes', 'visibility', visibility);
    if (map.current.getLayer('railway_routes_scenic_outline')) {
      map.current.setLayoutProperty('railway_routes_scenic_outline', 'visibility', visibility);
    }
  }, [showRoutesLayer, mapLoaded]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    map.current.setLayoutProperty(
      'stations',
      'visibility',
      showStationsLayer ? 'visible' : 'none'
    );
  }, [showStationsLayer, mapLoaded]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    map.current.setLayoutProperty(
      'admin_notes',
      'visibility',
      showNotesLayer ? 'visible' : 'none'
    );
  }, [showNotesLayer, mapLoaded]);

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

    const visibility = isEditingGeometry ? 'none' : (showRoutesLayer ? 'visible' : 'none');

    // Toggle both railway routes and scenic outline layers together
    map.current.setLayoutProperty('railway_routes', 'visibility', visibility);
    if (map.current.getLayer('railway_routes_scenic_outline')) {
      map.current.setLayoutProperty('railway_routes_scenic_outline', 'visibility', visibility);
    }
  }, [isEditingGeometry, showRoutesLayer, mapLoaded]);

  // Handle selected route highlighting
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    if (selectedRouteId) {
      // Convert selectedRouteId to number (track_id is the feature ID, which is a number)
      const trackIdNum = parseInt(selectedRouteId, 10);

      map.current.setPaintProperty('railway_routes', 'line-color', [
        'case',
        ['==', ['id'], trackIdNum],
        COLORS.railwayRoutes.selected, // Selected routes always orange
        ['==', ['get', 'is_valid'], false],
        COLORS.railwayRoutes.invalid, // Unselected invalid routes are grey
        COLORS.railwayRoutes.created
      ]);
      map.current.setPaintProperty('railway_routes', 'line-width', [
        'case',
        ['==', ['id'], trackIdNum],
        5,
        ['==', ['get', 'usage_type'], 1],
        2, // Special routes = thinner
        3  // Normal routes = standard width
      ]);
      map.current.setPaintProperty('railway_routes', 'line-opacity', [
        'case',
        ['==', ['id'], trackIdNum],
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
  }, [selectedRouteId, mapLoaded]);

  // Handle railway routes refresh when routes are saved/deleted
  useEffect(() => {
    if (!map.current || !mapLoaded || refreshTrigger === undefined) return;
    if (refreshTrigger === 0) return; // Skip initial render

    // Update cache buster
    const newCacheBuster = Date.now();
    setRoutesCacheBuster(newCacheBuster);

    // Reload railway_routes tiles
    const hasRoutesLayer = map.current.getLayer('railway_routes');
    const hasScenicOutlineLayer = map.current.getLayer('railway_routes_scenic_outline');
    const hasRoutesSource = map.current.getSource('railway_routes');

    // Remove layers first (both layers use the same source)
    if (hasRoutesLayer) {
      map.current.removeLayer('railway_routes');
    }
    if (hasScenicOutlineLayer) {
      map.current.removeLayer('railway_routes_scenic_outline');
    }

    // Now we can safely remove the source
    if (hasRoutesSource) {
      map.current.removeSource('railway_routes');
    }

    // Re-add source with new cache buster
    map.current.addSource('railway_routes', createRailwayRoutesSource({ cacheBuster: newCacheBuster }));

    // Re-add layers (scenic outline first, then main routes layer on top)
    map.current.addLayer(createScenicRoutesOutlineLayer());
    map.current.addLayer(createRailwayRoutesLayer());

    // Explicitly set visibility based on current state
    const visibility = showRoutesLayer ? 'visible' : 'none';
    map.current.setLayoutProperty('railway_routes', 'visibility', visibility);
    map.current.setLayoutProperty('railway_routes_scenic_outline', 'visibility', visibility);

    // Re-apply selected route highlighting if needed
    if (selectedRouteId) {
      // Convert selectedRouteId to number (track_id is the feature ID, which is a number)
      const trackIdNum = parseInt(selectedRouteId, 10);

      map.current.setPaintProperty('railway_routes', 'line-color', [
        'case',
        ['==', ['id'], trackIdNum],
        COLORS.railwayRoutes.selected, // Selected routes always orange
        ['==', ['get', 'is_valid'], false],
        COLORS.railwayRoutes.invalid, // Unselected invalid routes are grey
        COLORS.railwayRoutes.created
      ]);
      map.current.setPaintProperty('railway_routes', 'line-width', [
        'case',
        ['==', ['id'], trackIdNum],
        5,
        ['==', ['get', 'usage_type'], 1],
        2, // Special routes = thinner
        3  // Normal routes = standard width
      ]);
      map.current.setPaintProperty('railway_routes', 'line-opacity', [
        'case',
        ['==', ['id'], trackIdNum],
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

    // Force map repaint to clear any cached tiles
    map.current.triggerRepaint();
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

      // Optionally zoom to show the preview route (but not in edit geometry mode)
      if (previewRoute.coordinates.length > 0 && !isEditingGeometry) {
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
  }, [previewRoute, mapLoaded]);

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
  }, [selectedCoordinates, mapLoaded]);

  // Handle route endpoints layer visualization
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Remove existing route endpoints layers if any
    if (map.current.getLayer('route-endpoints')) {
      map.current.removeLayer('route-endpoints');
    }
    if (map.current.getSource('route-endpoints')) {
      map.current.removeSource('route-endpoints');
    }

    if (routeEndpoints && routeEndpoints.features.length > 0) {
      console.log('[VectorAdminMap] Adding route endpoints layer with', routeEndpoints.features.length, 'endpoints');

      // Add route endpoints as a GeoJSON source
      map.current.addSource('route-endpoints', {
        type: 'geojson',
        data: routeEndpoints
      });

      // Add route endpoints layer
      // Note: selected-points layer will be added after this, so it will naturally be on top
      map.current.addLayer({
        'id': 'route-endpoints',
        'type': 'circle',
        'source': 'route-endpoints',
        'paint': {
          'circle-radius': 5,
          'circle-color': '#3b82f6', // Blue color for existing route endpoints
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.8
        }
      });

      console.log('[VectorAdminMap] Route endpoints layer added');
    }
  }, [routeEndpoints, mapLoaded]);

  // Handle layer visibility for route endpoints
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const hasLayer = map.current.getLayer('route-endpoints');
    if (hasLayer) {
      map.current.setLayoutProperty(
        'route-endpoints',
        'visibility',
        showEndpointsLayer ? 'visible' : 'none'
      );
    }
  }, [showEndpointsLayer, mapLoaded]);

  // Handle focus on route geometry (fly to route when selected)
  useEffect(() => {
    // Don't pan/zoom when in edit geometry mode
    if (!map.current || !mapLoaded || !focusGeometry || isEditingGeometry) return;

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
  }, [focusGeometry, mapLoaded, isEditingGeometry]);

  // Handle right-click for admin notes (create/edit)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const handleRightClick = async (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();

      const coordinate: [number, number] = [e.lngLat.lng, e.lngLat.lat];

      // Check if clicking on an existing note
      const noteFeatures = map.current!.queryRenderedFeatures(e.point, {
        layers: ['admin_notes']
      });

      let noteId: number | null = null;
      let noteText = '';

      if (noteFeatures && noteFeatures.length > 0) {
        // Editing existing note
        noteId = noteFeatures[0].properties?.id;
        if (noteId) {
          try {
            const note = await getAdminNote(noteId);
            if (note) {
              noteText = note.text;
            }
          } catch (error) {
            console.error('Failed to load note:', error);
            return;
          }
        }
      }

      // Close existing popup if any
      if (notesPopupRef.current) {
        notesPopupRef.current.remove();
      }

      // Create popup container
      const popupContainer = document.createElement('div');

      // Determine popup anchor based on click position
      // If clicked near top of screen, show popup below; otherwise show above
      const clickY = e.point.y;
      const mapHeight = map.current!.getContainer().clientHeight;
      const anchor = clickY < mapHeight * 0.3 ? 'top' : 'bottom';

      // Create popup with smart positioning
      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        maxWidth: 'none',
        anchor: anchor, // Dynamic anchor based on click position
        offset: 15, // Offset from the point
      })
        .setLngLat(e.lngLat)
        .setDOMContent(popupContainer)
        .addTo(map.current!);

      notesPopupRef.current = popup;

      // Render React component into popup
      const root = createRoot(popupContainer);

      const handleClose = () => {
        popup.remove();
        notesPopupRef.current = null;
        root.unmount();
      };

      const handleSaved = () => {
        // Refresh notes layer
        setNotesCacheBuster(Date.now());
      };

      root.render(
        <NotesPopup
          noteId={noteId}
          initialText={noteText}
          coordinate={coordinate}
          onClose={handleClose}
          onSaved={handleSaved}
          showSuccess={showSuccess}
          showError={showError}
        />
      );
    };

    // Handle click outside popup to close it
    const handleMapClick = (e: maplibregl.MapMouseEvent) => {
      if (!notesPopupRef.current) return;

      // Check if click is on a note (to open edit)
      const noteFeatures = map.current!.queryRenderedFeatures(e.point, {
        layers: ['admin_notes']
      });
      if (noteFeatures && noteFeatures.length > 0) {
        return; // Let the right-click handler handle this
      }

      // Check if click is inside the popup element
      const popupElement = notesPopupRef.current.getElement();
      if (popupElement && e.originalEvent.target instanceof Node) {
        if (popupElement.contains(e.originalEvent.target as Node)) {
          return; // Click is inside popup, don't close
        }
      }

      // Click is outside popup, close it
      notesPopupRef.current.remove();
      notesPopupRef.current = null;
    };

    map.current.on('contextmenu', handleRightClick);
    map.current.on('click', handleMapClick);

    return () => {
      if (map.current) {
        map.current.off('contextmenu', handleRightClick);
        map.current.off('click', handleMapClick);
      }
      if (notesPopupRef.current) {
        notesPopupRef.current.remove();
        notesPopupRef.current = null;
      }
    };
  }, [mapLoaded, map, showSuccess, showError]);

  // Refresh notes layer when cache buster changes
  useEffect(() => {
    if (!map.current || !mapLoaded || notesCacheBuster === Date.now()) return;

    const hasNotesLayer = map.current.getLayer('admin_notes');
    const hasNotesSource = map.current.getSource('admin_notes');

    if (hasNotesLayer) {
      map.current.removeLayer('admin_notes');
    }
    if (hasNotesSource) {
      map.current.removeSource('admin_notes');
    }

    map.current.addSource('admin_notes', createAdminNotesSource(notesCacheBuster));
    map.current.addLayer(createAdminNotesLayer());

    map.current.setLayoutProperty(
      'admin_notes',
      'visibility',
      showNotesLayer ? 'visible' : 'none'
    );

    map.current.triggerRepaint();
  }, [notesCacheBuster, mapLoaded, map, showNotesLayer]);

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
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={showEndpointsLayer}
              onChange={() => setShowEndpointsLayer(!showEndpointsLayer)}
              className="mr-2"
            />
            Route Endpoints
          </label>
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={showNotesLayer}
              onChange={() => setShowNotesLayer(!showNotesLayer)}
              className="mr-2"
            />
            Admin Notes
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
