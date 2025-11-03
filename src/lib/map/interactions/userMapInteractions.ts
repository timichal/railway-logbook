import type maplibreglType from 'maplibre-gl';
import maplibregl from 'maplibre-gl';
import { closeAllPopups } from '@/lib/map';
import { getUsageLabel } from '@/lib/constants';
import { getUserRouteWidthExpression } from '../utils/userRouteStyling';

interface EditingFeature {
  track_id: string;
  from_station: string;
  to_station: string;
  track_number: string | null;
  description: string;
  usage_types: string;
  link: string | null;
  date: string | null;
  note: string | null;
  partial: boolean | null;
}

interface UserMapInteractionCallbacks {
  onRouteClick: (feature: EditingFeature) => void;
  onQuickLog: (trackId: string) => void;
  onRefreshAfterQuickLog: () => Promise<void>;
}

/**
 * Setup all map interactions for user map
 */
export function setupUserMapInteractions(
  mapInstance: maplibreglType.Map,
  callbacks: UserMapInteractionCallbacks
) {
  const { onRouteClick, onQuickLog, onRefreshAfterQuickLog } = callbacks;
  let currentPopup: maplibregl.Popup | null = null;
  let clickPopup: maplibregl.Popup | null = null;

  // Click handler for editing routes
  const handleClick = (e: maplibreglType.MapLayerMouseEvent) => {
    if (!e.features || e.features.length === 0) return;

    const feature = e.features[0];
    const properties = feature.properties;
    if (!properties) return;

    // Close any open popups
    closeAllPopups();
    if (currentPopup) {
      currentPopup.remove();
      currentPopup = null;
    }
    if (clickPopup) {
      clickPopup.remove();
      clickPopup = null;
    }

    // Highlight clicked route with increased width
    mapInstance.setPaintProperty('railway_routes', 'line-width', [
      'case',
      ['==', ['get', 'track_id'], properties.track_id],
      [
        'case',
        ['==', ['get', 'usage_type'], 1],
        4, // Special routes: 2 + 2 = 4
        5  // Normal routes: 3 + 2 = 5
      ],
      // Default width for non-selected routes
      [
        'case',
        ['==', ['get', 'usage_type'], 1],
        2, // Special routes = thinner
        3  // Normal routes = standard width
      ]
    ]);

    // Build click menu popup content
    let popupContent = `<div class="railway-click-menu" style="color: black; min-width: 200px;"><h3 class="font-bold text-lg mb-2" style="color: black;">${properties.track_number ? `${properties.track_number} ` : ""}${properties.from_station} ⟷ ${properties.to_station}</h3>`;

    let formattedDescription = "";
    formattedDescription += `${getUsageLabel(properties.usage_type)} route<br />`;

    if (properties.frequency !== "{}") {
      formattedDescription += `<b>Frequency:</b> ${properties.frequency.slice(1, -1).replaceAll(",", ", ")}<br />`
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
      formattedDescription += `<span style="color: black;">Date: ${new Intl.DateTimeFormat("cs-CZ").format(new Date(properties.date))}</span>`;
    }
    if (properties.note) {
      formattedDescription += `<br /><span style="color: black;">${properties.note}</span>`;
    }

    popupContent += `<div class="mb-3">${formattedDescription}</div>`;

    // Action buttons
    popupContent += `<div class="flex flex-col gap-2" style="border-top: 1px solid #e5e7eb; padding-top: 12px;">`;

    // Quick log button
    popupContent += `
      <button
        class="quick-log-btn px-3 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 cursor-pointer"
        data-track-id="${properties.track_id}"
        style="border: none; cursor: pointer;"
      >
        Quick log
      </button>
    `;

    // Manage trips button
    popupContent += `
      <button
        class="edit-log-btn px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 cursor-pointer"
        data-track-id="${properties.track_id}"
        style="border: none; cursor: pointer;"
      >
        Manage trips
      </button>
    `;

    popupContent += `</div></div>`;

    // Create and show click popup
    clickPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: false })
      .setLngLat(e.lngLat)
      .setHTML(popupContent)
      .addTo(mapInstance);

    // Reset route width when popup is closed (via X button or clicking another route)
    // Note: If edit form is opened, openEditForm will immediately re-highlight
    clickPopup.on('close', () => {
      mapInstance.setPaintProperty('railway_routes', 'line-width', getUserRouteWidthExpression());
    });

    // Add event listeners to buttons after popup is added to DOM
    setTimeout(() => {
      const quickLogBtn = document.querySelector('.quick-log-btn');
      const editBtn = document.querySelector('.edit-log-btn');

      if (quickLogBtn) {
        quickLogBtn.addEventListener('click', async () => {
          const trackId = quickLogBtn.getAttribute('data-track-id');
          if (trackId) {
            // Disable button and change text
            quickLogBtn.setAttribute('disabled', 'true');
            quickLogBtn.classList.remove('bg-green-600', 'hover:bg-green-700');
            quickLogBtn.classList.add('bg-green-400', 'cursor-not-allowed');
            quickLogBtn.textContent = 'Logged!';

            await onQuickLog(trackId);
            await onRefreshAfterQuickLog();
          }
        });
      }

      if (editBtn) {
        editBtn.addEventListener('click', () => {
          if (clickPopup) {
            clickPopup.remove();
            clickPopup = null;
          }
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
            partial: properties.partial
          });
        });
      }
    }, 10);
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
      formattedDescription += `<b>Frequency:</b> ${properties.frequency.slice(1, -1).replaceAll(",", ", ")}<br />`
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
      formattedDescription += `<span style="color: black;">Date: ${new Intl.DateTimeFormat("cs-CZ").format(new Date(properties.date))}</span><br />`;
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

  // Handle clicks outside routes to close click popup
  const handleMapClick = (e: maplibreglType.MapMouseEvent) => {
    // Check if click is on a railway route
    const features = mapInstance.queryRenderedFeatures(e.point, {
      layers: ['railway_routes']
    });

    // If not clicking on a route, close the click popup and reset highlight
    if (features.length === 0 && clickPopup) {
      clickPopup.remove();
      clickPopup = null;

      // Reset route width to default
      mapInstance.setPaintProperty('railway_routes', 'line-width', getUserRouteWidthExpression());
    }
  };

  // Attach route handlers
  mapInstance.on('click', 'railway_routes', handleClick);
  mapInstance.on('mousemove', 'railway_routes', handleRouteMouseMove);
  mapInstance.on('mouseenter', 'railway_routes', handleRouteMouseEnter);
  mapInstance.on('mouseleave', 'railway_routes', handleRouteMouseLeave);

  // Attach map click handler for closing popup
  mapInstance.on('click', handleMapClick);

  // Attach station handlers (added after routes, so they take precedence due to layer order)
  mapInstance.on('mousemove', 'stations', handleStationMouseMove);
  mapInstance.on('mouseenter', 'stations', handleStationMouseEnter);
  mapInstance.on('mouseleave', 'stations', handleStationMouseLeave);

  // Cleanup function
  return () => {
    if (currentPopup) {
      currentPopup.remove();
    }
    if (clickPopup) {
      clickPopup.remove();
    }
    // Remove route handlers
    mapInstance.off('click', 'railway_routes', handleClick);
    mapInstance.off('mousemove', 'railway_routes', handleRouteMouseMove);
    mapInstance.off('mouseenter', 'railway_routes', handleRouteMouseEnter);
    mapInstance.off('mouseleave', 'railway_routes', handleRouteMouseLeave);
    // Remove map click handler
    mapInstance.off('click', handleMapClick);
    // Remove station handlers
    mapInstance.off('mousemove', 'stations', handleStationMouseMove);
    mapInstance.off('mouseenter', 'stations', handleStationMouseEnter);
    mapInstance.off('mouseleave', 'stations', handleStationMouseLeave);
  };
}
