import type maplibreglType from 'maplibre-gl';
import maplibregl from 'maplibre-gl';
import { getUsageLabel } from '@/lib/constants';
import type { SelectedRoute, Station } from '@/lib/types';

interface UserMapInteractionCallbacks {
  onRouteClick: (feature: SelectedRoute) => void;
  onStationClick?: (station: Station | null) => void;
}

/**
 * Setup all map interactions for user map
 */
export function setupUserMapInteractions(
  mapInstance: maplibreglType.Map,
  callbacks: UserMapInteractionCallbacks
) {
  const { onRouteClick, onStationClick } = callbacks;
  let currentPopup: maplibregl.Popup | null = null;

  // Click handler for adding routes to selection
  const handleClick = (e: maplibreglType.MapLayerMouseEvent) => {
    if (!e.features || e.features.length === 0) return;

    const feature = e.features[0];
    const properties = feature.properties;
    if (!properties) return;

    // Add route to selection
    onRouteClick({
      track_id: properties.track_id,
      from_station: properties.from_station,
      to_station: properties.to_station,
      track_number: properties.track_number || null,
      description: properties.description,
      usage_types: properties.usage_types,
      link: properties.link || null,
      date: properties.date,
      note: properties.note,
      partial: properties.partial,
      length_km: Number(properties.length_km) || 0
    });
  };

  // Hover handler for route popups
  const handleRouteMouseMove = (e: maplibreglType.MapLayerMouseEvent) => {
    if (!e.features || e.features.length === 0) {
      if (currentPopup) {
        currentPopup.remove();
        currentPopup = null;
      }
      return;
    }

    const feature = e.features[0];
    const properties = feature.properties;

    if (!properties) return;

    let popupContent = `<div class="railway-popup" style="color: black;"><h3 class="font-bold text-lg mb-2" style="color: black;">${properties.track_number ? `${properties.track_number} ` : ""}${properties.from_station} ⟷ ${properties.to_station}</h3>`;

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

    if (properties.date || properties.note) {
      formattedDescription += `<hr class="my-2" />`;
    }
    if (properties.date) {
      formattedDescription += `<span style="color: black;">Last ride: ${new Intl.DateTimeFormat("cs-CZ").format(new Date(properties.date))}</span><br />`;
    }
    if (properties.note) {
      formattedDescription += `<span style="color: black;">${properties.note}</span>`;
    }

    popupContent += `<div class="mb-2">${formattedDescription}</div>`;
    popupContent += `</div>`;

    // Remove old popup if exists
    if (currentPopup) {
      currentPopup.remove();
    }

    // Create new popup
    currentPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
      .setLngLat(e.lngLat)
      .setHTML(popupContent)
      .addTo(mapInstance);
  };

  // Hover handler for station popups (takes precedence)
  const handleStationMouseMove = (e: maplibreglType.MapLayerMouseEvent) => {
    if (!e.features || e.features.length === 0) {
      return;
    }

    const feature = e.features[0];
    const properties = feature.properties;

    if (!properties) return;

    let popupContent = `<div class="station-popup" style="color: black;">`;

    if (properties.name) {
      popupContent += `<h3 class="font-bold text-base mb-1" style="color: black;">${properties.name}</h3>`;
      popupContent += `<div class="text-xs text-gray-600">Station</div>`;
    }

    popupContent += `</div>`;

    // Remove old popup if exists
    if (currentPopup) {
      currentPopup.remove();
    }

    // Create new popup for station
    currentPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
      .setLngLat(e.lngLat)
      .setHTML(popupContent)
      .addTo(mapInstance);
  };

  // Cursor handlers for routes
  const handleRouteMouseEnter = () => {
    mapInstance.getCanvas().style.cursor = 'pointer';
  };

  const handleRouteMouseLeave = () => {
    mapInstance.getCanvas().style.cursor = '';
    if (currentPopup) {
      currentPopup.remove();
      currentPopup = null;
    }
  };

  // Cursor handlers for stations
  const handleStationMouseEnter = () => {
    mapInstance.getCanvas().style.cursor = 'pointer';
  };

  const handleStationMouseLeave = () => {
    mapInstance.getCanvas().style.cursor = '';
    if (currentPopup) {
      currentPopup.remove();
      currentPopup = null;
    }
  };

  // Click handler for stations (Journey Planner)
  const handleStationClick = (e: maplibreglType.MapLayerMouseEvent) => {
    if (!e.features || e.features.length === 0 || !onStationClick) return;

    const feature = e.features[0];
    const properties = feature.properties;
    const geometry = feature.geometry;

    if (!properties || !geometry || geometry.type !== 'Point') return;

    // Validate station data before creating Station object
    if (!properties.id || !properties.name || !geometry.coordinates) return;

    // Convert to Station type
    const station: Station = {
      id: properties.id,
      name: properties.name,
      coordinates: geometry.coordinates as [number, number]
    };

    onStationClick(station);
  };

  // Attach route handlers
  mapInstance.on('click', 'railway_routes', handleClick);
  mapInstance.on('mousemove', 'railway_routes', handleRouteMouseMove);
  mapInstance.on('mouseenter', 'railway_routes', handleRouteMouseEnter);
  mapInstance.on('mouseleave', 'railway_routes', handleRouteMouseLeave);

  // Attach station handlers (added after routes, so they take precedence due to layer order)
  mapInstance.on('click', 'stations', handleStationClick);
  mapInstance.on('mousemove', 'stations', handleStationMouseMove);
  mapInstance.on('mouseenter', 'stations', handleStationMouseEnter);
  mapInstance.on('mouseleave', 'stations', handleStationMouseLeave);

  // Cleanup function
  return () => {
    if (currentPopup) {
      currentPopup.remove();
    }
    // Remove route handlers
    mapInstance.off('click', 'railway_routes', handleClick);
    mapInstance.off('mousemove', 'railway_routes', handleRouteMouseMove);
    mapInstance.off('mouseenter', 'railway_routes', handleRouteMouseEnter);
    mapInstance.off('mouseleave', 'railway_routes', handleRouteMouseLeave);
    // Remove station handlers
    mapInstance.off('click', 'stations', handleStationClick);
    mapInstance.off('mousemove', 'stations', handleStationMouseMove);
    mapInstance.off('mouseenter', 'stations', handleStationMouseEnter);
    mapInstance.off('mouseleave', 'stations', handleStationMouseLeave);
  };
}
