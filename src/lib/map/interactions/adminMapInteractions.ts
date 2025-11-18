import type maplibreglType from 'maplibre-gl';
import maplibregl from 'maplibre-gl';
import type { MutableRefObject } from 'react';
import { applyRailwayPartsStyling } from '../utils/railwayPartsStyling';
import { getUsageLabel } from '@/lib/constants';
import { splitRailwayPart } from '@/lib/adminPartActions';

interface AdminMapCallbacks {
  onPartClickRef: MutableRefObject<((partId: string) => void) | undefined>;
  onRouteSelectRef: MutableRefObject<((routeId: string) => void) | undefined>;
  selectedPartsRef: MutableRefObject<{ startingId: string; endingId: string } | undefined>;
  previewRouteRef: MutableRefObject<unknown>;
  updatePartsStyleRef: MutableRefObject<(() => void) | null>;
  isSplittingModeRef: MutableRefObject<boolean | undefined>;
  splittingPartIdRef: MutableRefObject<string | null | undefined>;
  onExitSplitModeRef: MutableRefObject<(() => void) | undefined>;
  onRefreshMapRef: MutableRefObject<(() => void) | undefined>;
  showErrorRef: MutableRefObject<((message: string) => void) | undefined>;
  showSuccessRef: MutableRefObject<((message: string) => void) | undefined>;
  onSplitSuccessRef: MutableRefObject<((parentId: string) => void) | undefined>;
}

/**
 * Setup all map interactions for admin map
 */
export function setupAdminMapInteractions(
  mapInstance: maplibreglType.Map,
  callbacks: AdminMapCallbacks
) {
  const { onPartClickRef, onRouteSelectRef, selectedPartsRef, previewRouteRef, updatePartsStyleRef, isSplittingModeRef, splittingPartIdRef, onExitSplitModeRef, onRefreshMapRef, showErrorRef, showSuccessRef, onSplitSuccessRef } = callbacks;

  // Shared click handler logic for both railway_parts and railway_part_splits
  const handlePartClick = async (e: maplibreglType.MapLayerMouseEvent) => {
    if (!e.features || e.features.length === 0) return;

    // Check if we're in splitting mode
    if (isSplittingModeRef.current && splittingPartIdRef.current) {
      // Handle split point click
      const clickedCoordinate: [number, number] = [e.lngLat.lng, e.lngLat.lat];

      try {
        const result = await splitRailwayPart(splittingPartIdRef.current, clickedCoordinate);

        if (result.success) {
          console.log('Split successful:', result.message);
          // Notify parent component of successful split
          if (onSplitSuccessRef.current && splittingPartIdRef.current) {
            onSplitSuccessRef.current(splittingPartIdRef.current);
          }

          // Exit split mode
          if (onExitSplitModeRef.current) {
            onExitSplitModeRef.current();
          }

          // Refresh map to show the split parts
          if (onRefreshMapRef.current) {
            onRefreshMapRef.current();
          }
        } else {
          console.error('Split failed:', result.message);
          showErrorRef.current?.(result.message);
        }
      } catch (error) {
        console.error('Error during split:', error);
        showErrorRef.current?.(`Error splitting part: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      return; // Don't handle normal part click logic
    }

    // Normal part click logic (not in splitting mode)
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
  };

  // Click handler for railway_part_splits (split parts have priority)
  mapInstance.on('click', 'railway_part_splits', handlePartClick);

  // Click handler for railway_parts
  // Only handle if we didn't click on a split part
  mapInstance.on('click', 'railway_parts', (e) => {
    // Check if we also clicked on a split part
    const splitFeatures = mapInstance.queryRenderedFeatures(e.point, {
      layers: ['railway_part_splits']
    });

    // If we clicked on a split part, let that handler deal with it
    if (splitFeatures && splitFeatures.length > 0) {
      return;
    }

    // Otherwise, handle the normal part click
    handlePartClick(e);
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
    const splitFeatures = mapInstance.queryRenderedFeatures(e.point, {
      layers: ['railway_part_splits']
    });

    // If we didn't click on any features, unselect the route
    if ((!routeFeatures || routeFeatures.length === 0) &&
      (!partFeatures || partFeatures.length === 0) &&
      (!splitFeatures || splitFeatures.length === 0)) {
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
    const splittingPartId = isSplittingModeRef.current ? splittingPartIdRef.current : null;

    applyRailwayPartsStyling(mapInstance, {
      hoveredPartId,
      startingId,
      endingId,
      isPreviewActive,
      splittingPartId,
    });
  };

  mapInstance.on('mouseenter', 'railway_parts', (e) => {
    // Check if we're also hovering over a split part
    const splitFeatures = mapInstance.queryRenderedFeatures(e.point, {
      layers: ['railway_part_splits']
    });

    // If hovering over a split part, let that handler deal with it
    if (splitFeatures && splitFeatures.length > 0) {
      return;
    }

    // Use crosshair cursor in splitting mode, otherwise pointer
    if (isSplittingModeRef.current) {
      mapInstance.getCanvas().style.cursor = 'crosshair';
    } else {
      mapInstance.getCanvas().style.cursor = 'pointer';
    }
    hoveredPartId = e.features?.[0]?.properties?.id?.toString() || null;
    updatePartsStyle();
  });

  mapInstance.on('mouseleave', 'railway_parts', () => {
    mapInstance.getCanvas().style.cursor = '';
    hoveredPartId = null;
    updatePartsStyle();
  });

  // Hover effects for railway_part_splits (same as railway_parts)
  mapInstance.on('mouseenter', 'railway_part_splits', (e) => {
    // Use crosshair cursor in splitting mode, otherwise pointer
    if (isSplittingModeRef.current) {
      mapInstance.getCanvas().style.cursor = 'crosshair';
    } else {
      mapInstance.getCanvas().style.cursor = 'pointer';
    }
    hoveredPartId = e.features?.[0]?.properties?.id?.toString() || null;
    updatePartsStyle();
  });

  mapInstance.on('mouseleave', 'railway_part_splits', () => {
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
          formattedDescription += `<b>Frequency:</b> ${properties.frequency.slice(1, -1).replaceAll(",", ", ").replaceAll("\"", "")}<br />`
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
