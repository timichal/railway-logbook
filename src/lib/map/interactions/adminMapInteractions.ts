import type maplibreglType from 'maplibre-gl';
import maplibregl from 'maplibre-gl';
import type { MutableRefObject } from 'react';
import { formatRouteMetadataBadges } from '@/lib/map/utils/tooltipFormatting';

interface AdminMapCallbacks {
  onCoordinateClickRef: MutableRefObject<((coordinate: [number, number]) => void) | undefined>;
  onRouteSelectRef: MutableRefObject<((routeId: string) => void) | undefined>;
}

/**
 * Setup all map interactions for admin map
 */
export function setupAdminMapInteractions(
  mapInstance: maplibreglType.Map,
  callbacks: AdminMapCallbacks
) {
  const { onCoordinateClickRef, onRouteSelectRef } = callbacks;

  // Click handler for railway_parts - extracts exact click coordinate
  const handlePartClick = (e: maplibreglType.MapLayerMouseEvent) => {
    if (!e.features || e.features.length === 0) return;

    // Don't handle part clicks if we clicked on a route endpoint (only if layer exists)
    if (mapInstance.getLayer('route-endpoints')) {
      const endpointFeatures = mapInstance.queryRenderedFeatures(e.point, {
        layers: ['route-endpoints']
      });
      if (endpointFeatures && endpointFeatures.length > 0) {
        return; // Let the endpoint handler handle this
      }
    }

    // Don't handle part clicks if we also clicked on a route
    const routeFeatures = mapInstance.queryRenderedFeatures(e.point, {
      layers: ['railway_routes']
    });
    if (routeFeatures && routeFeatures.length > 0) {
      return;
    }

    if (!onCoordinateClickRef.current) return;

    // Extract exact click coordinate
    const clickedCoordinate: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    console.log('adminMapInteractions: Part clicked at coordinate:', clickedCoordinate);
    onCoordinateClickRef.current(clickedCoordinate);
  };

  // Click handler for railway_parts
  mapInstance.on('click', 'railway_parts', handlePartClick);

  // Click handler for route endpoints - conditionally add if layer exists
  // Note: This layer is dynamically added/removed, so we handle clicks through a wrapper
  const handleMapClick = (e: maplibreglType.MapMouseEvent) => {
    // Check if we have the route-endpoints layer and if we clicked on an endpoint
    if (mapInstance.getLayer('route-endpoints')) {
      const endpointFeatures = mapInstance.queryRenderedFeatures(e.point, {
        layers: ['route-endpoints']
      });
      if (endpointFeatures && endpointFeatures.length > 0) {
        // Manually call the endpoint click handler with proper features
        const feature = endpointFeatures[0];
        if (feature.geometry.type === 'Point' && onCoordinateClickRef.current) {
          const clickedCoordinate = feature.geometry.coordinates as [number, number];
          onCoordinateClickRef.current(clickedCoordinate);
        }
      }
    }
  };

  // We can't use layer-specific click for dynamic layers, so use general map click
  mapInstance.on('click', handleMapClick);

  // Click handler for railway routes
  mapInstance.on('click', 'railway_routes', (e) => {
    if (!e.features || e.features.length === 0) return;
    const feature = e.features[0];

    if (!onRouteSelectRef.current) return;

    // track_id is the feature ID (not in properties), convert to string
    const trackId = String(feature.id);
    onRouteSelectRef.current(trackId);

    // Stop event propagation to prevent map click handler from firing
    e.preventDefault();
  });

  // Click handler for map (when clicking outside features) to unselect route
  mapInstance.on('click', (e) => {
    // Check if we clicked on any features
    const routeFeatures = mapInstance.queryRenderedFeatures(e.point, {
      layers: ['railway_routes']
    });
    const partFeatures = mapInstance.queryRenderedFeatures(e.point, {
      layers: ['railway_parts']
    });

    // Also check for endpoint clicks
    let endpointFeatures = null;
    if (mapInstance.getLayer('route-endpoints')) {
      endpointFeatures = mapInstance.queryRenderedFeatures(e.point, {
        layers: ['route-endpoints']
      });
    }

    // If we didn't click on any features, unselect the route
    if ((!routeFeatures || routeFeatures.length === 0) &&
      (!partFeatures || partFeatures.length === 0) &&
      (!endpointFeatures || endpointFeatures.length === 0)) {
      if (onRouteSelectRef.current) {
        onRouteSelectRef.current('');  // Empty string to unselect
      }
    }
  });

  // Hover effects for railway parts
  let hoveredPartId: number | string | null = null;

  mapInstance.on('mouseenter', 'railway_parts', (e) => {
    // Check if we're also hovering over a railway route
    const routeFeatures = mapInstance.queryRenderedFeatures(e.point, {
      layers: ['railway_routes']
    });

    // If hovering over a route, don't show part hover
    if (routeFeatures && routeFeatures.length > 0) {
      return;
    }

    mapInstance.getCanvas().style.cursor = 'pointer';

    // Set hover state for the feature
    if (e.features && e.features.length > 0) {
      const feature = e.features[0];
      // Use the MVT feature ID (numeric id from database)
      const partId = feature.id;

      if (partId !== undefined && partId !== hoveredPartId) {
        // Remove hover from previous part
        if (hoveredPartId !== null) {
          mapInstance.setFeatureState(
            { source: 'railway_parts', sourceLayer: 'railway_parts', id: hoveredPartId },
            { hover: false }
          );
        }

        // Add hover to current part
        hoveredPartId = partId;
        mapInstance.setFeatureState(
          { source: 'railway_parts', sourceLayer: 'railway_parts', id: partId },
          { hover: true }
        );
      }
    }
  });

  mapInstance.on('mouseleave', 'railway_parts', () => {
    mapInstance.getCanvas().style.cursor = '';

    // Remove hover state from the last hovered feature
    if (hoveredPartId !== null) {
      mapInstance.setFeatureState(
        { source: 'railway_parts', sourceLayer: 'railway_parts', id: hoveredPartId },
        { hover: false }
      );
      hoveredPartId = null;
    }
  });

  // Hover effects for railway routes with popup
  let routeHoverPopup: maplibregl.Popup | null = null;

  mapInstance.on('mouseenter', 'railway_routes', (e) => {
    mapInstance.getCanvas().style.cursor = 'pointer';

    if (e.features && e.features.length > 0) {
      const feature = e.features[0];
      const properties = feature.properties;

      if (properties) {
        let formattedDescription = "";

        // Route metadata badges (usage type, scenic, hsl, frequency)
        formattedDescription += formatRouteMetadataBadges({
          usage_type: properties.usage_type,
          scenic: properties.scenic,
          hsl: properties.hsl,
          frequency: properties.frequency
        });
        if (properties.description) {
          formattedDescription += `<b>Note:</b> ${properties.description}<br />`;
        }
        if (properties.link) {
          formattedDescription += `<a href="${properties.link}" target="_blank" rel="noopener noreferrer" style="color: blue; text-decoration: underline;">Website</a><br />`;
        }

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
              <h3 style="font-weight: bold; margin-bottom: 4px;">${properties.track_number ? `${properties.track_number} ` : ""}${properties.from_station} ⟷ ${properties.to_station}</h3>
              ${formattedDescription}</p>
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

  // Hover effects for stations with popup
  let stationHoverPopup: maplibregl.Popup | null = null;

  mapInstance.on('mouseenter', 'stations', (e) => {
    mapInstance.getCanvas().style.cursor = 'pointer';

    if (e.features && e.features.length > 0) {
      const feature = e.features[0];
      const properties = feature.properties;

      if (properties) {
        if (stationHoverPopup) {
          stationHoverPopup.remove();
        }

        stationHoverPopup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 10,
          className: 'station-hover-popup'
        })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="color: black;">
              <h3 style="font-weight: bold; margin-bottom: 2px;">${properties.name || 'Unknown Station'}</h3>
              <div style="font-size: 0.75rem; color: #6b7280;">Station</div>
            </div>
          `)
          .addTo(mapInstance);
      }
    }
  });

  mapInstance.on('mouseleave', 'stations', () => {
    mapInstance.getCanvas().style.cursor = '';

    if (stationHoverPopup) {
      stationHoverPopup.remove();
      stationHoverPopup = null;
    }
  });

  // Hover effects for route endpoints with popup (handled through mousemove since layer is dynamic)
  let endpointHoverPopup: maplibregl.Popup | null = null;
  let isOverEndpoint = false;

  mapInstance.on('mousemove', (e) => {
    // Only check if the layer exists
    if (!mapInstance.getLayer('route-endpoints')) {
      if (endpointHoverPopup) {
        endpointHoverPopup.remove();
        endpointHoverPopup = null;
      }
      isOverEndpoint = false;
      return;
    }

    const features = mapInstance.queryRenderedFeatures(e.point, {
      layers: ['route-endpoints']
    });

    if (features && features.length > 0) {
      const feature = features[0];
      const properties = feature.properties;

      if (properties && !isOverEndpoint) {
        mapInstance.getCanvas().style.cursor = 'pointer';
        isOverEndpoint = true;

        if (endpointHoverPopup) {
          endpointHoverPopup.remove();
        }

        const endpointTypeLabel = properties.endpoint_type === 'start' ? 'Start' : 'End';

        endpointHoverPopup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 10,
          className: 'endpoint-hover-popup'
        })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="color: black;">
              <h3 style="font-weight: bold; margin-bottom: 2px;">${endpointTypeLabel} Point</h3>
              <div style="font-size: 0.85rem; color: #374151;">${properties.route_name}</div>
              <div style="font-size: 0.75rem; color: #6b7280; margin-top: 4px;">Click to use this coordinate</div>
            </div>
          `)
          .addTo(mapInstance);
      }
    } else if (isOverEndpoint) {
      // Mouse left the endpoint
      isOverEndpoint = false;
      if (endpointHoverPopup) {
        endpointHoverPopup.remove();
        endpointHoverPopup = null;
      }
    }
  });

  // Hover effects for admin notes with popup
  let noteHoverPopup: maplibregl.Popup | null = null;
  let hoveredNoteId: number | string | null = null;

  mapInstance.on('mouseenter', 'admin_notes', (e) => {
    mapInstance.getCanvas().style.cursor = 'pointer';

    if (e.features && e.features.length > 0) {
      const feature = e.features[0];
      const properties = feature.properties;
      const noteId = feature.id;

      // Set hover state for the feature
      if (noteId !== undefined && noteId !== hoveredNoteId) {
        // Remove hover from previous note
        if (hoveredNoteId !== null) {
          mapInstance.setFeatureState(
            { source: 'admin_notes', sourceLayer: 'admin_notes', id: hoveredNoteId },
            { hover: false }
          );
        }

        // Add hover to current note
        hoveredNoteId = noteId;
        mapInstance.setFeatureState(
          { source: 'admin_notes', sourceLayer: 'admin_notes', id: noteId },
          { hover: true }
        );
      }

      if (properties) {
        if (noteHoverPopup) {
          noteHoverPopup.remove();
        }

        noteHoverPopup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 10,
          className: 'admin-note-hover-popup'
        })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="color: black;">
              <h3 style="font-weight: bold; margin-bottom: 2px;">Admin Note</h3>
              <div style="font-size: 0.85rem; color: #374151;">${properties.text || ''}</div>
              <div style="font-size: 0.75rem; color: #6b7280; margin-top: 4px;">Right-click to edit</div>
            </div>
          `)
          .addTo(mapInstance);
      }
    }
  });

  mapInstance.on('mouseleave', 'admin_notes', () => {
    mapInstance.getCanvas().style.cursor = '';

    // Remove hover state from the last hovered note
    if (hoveredNoteId !== null) {
      mapInstance.setFeatureState(
        { source: 'admin_notes', sourceLayer: 'admin_notes', id: hoveredNoteId },
        { hover: false }
      );
      hoveredNoteId = null;
    }

    if (noteHoverPopup) {
      noteHoverPopup.remove();
      noteHoverPopup = null;
    }
  });
}
