import type maplibreglType from 'maplibre-gl';
import maplibregl from 'maplibre-gl';
import type { MutableRefObject } from 'react';
import { applyRailwayPartsStyling } from '../utils/railwayPartsStyling';
import { getUsageLabel } from '@/lib/constants';

interface AdminMapCallbacks {
  onPartClickRef: MutableRefObject<((partId: string) => void) | undefined>;
  onRouteSelectRef: MutableRefObject<((routeId: string) => void) | undefined>;
  selectedPartsRef: MutableRefObject<{ startingId: string; endingId: string } | undefined>;
  previewRouteRef: MutableRefObject<unknown>;
  updatePartsStyleRef: MutableRefObject<(() => void) | null>;
}

/**
 * Setup all map interactions for admin map
 */
export function setupAdminMapInteractions(
  mapInstance: maplibreglType.Map,
  callbacks: AdminMapCallbacks
) {
  const { onPartClickRef, onRouteSelectRef, selectedPartsRef, previewRouteRef, updatePartsStyleRef } = callbacks;

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

    // If we didn't click on any features, unselect the route
    if ((!routeFeatures || routeFeatures.length === 0) &&
      (!partFeatures || partFeatures.length === 0)) {
      if (onRouteSelectRef.current) {
        onRouteSelectRef.current('');  // Empty string to unselect
      }
    }
  });

  // Hover effects for railway parts
  let hoveredPartId: string | null = null;

  // Function to update parts styling based on selection and hover state
  const updatePartsStyle = () => {
    const isPreviewActive = previewRouteRef.current !== null;
    const selectedParts = selectedPartsRef.current;
    const startingId = selectedParts?.startingId;
    const endingId = selectedParts?.endingId;

    applyRailwayPartsStyling(mapInstance, {
      hoveredPartId,
      startingId,
      endingId,
      isPreviewActive,
    });
  };

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

  // Hover effects for railway routes with popup
  let routeHoverPopup: maplibregl.Popup | null = null;

  mapInstance.on('mouseenter', 'railway_routes', (e) => {
    mapInstance.getCanvas().style.cursor = 'pointer';

    if (e.features && e.features.length > 0) {
      const feature = e.features[0];
      const properties = feature.properties;

      if (properties) {
        let formattedDescription = "";
        formattedDescription += `${getUsageLabel(properties.usage_type)} route<br />`;

        if (properties.frequency !== "{}") {
          console.log(properties.frequency)
          formattedDescription += `<b>Frequency:</b> ${properties.frequency.slice(1, -1).replaceAll(",", ", ")}<br />`
        }
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

  // Store updatePartsStyle in ref
  updatePartsStyleRef.current = updatePartsStyle;
}
