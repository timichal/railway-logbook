'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { GeoJSONFeature, GeoJSONFeatureCollection } from '@/lib/types';

const usageMap: Record<number, string> = {
  0: 'Pravidelný provoz', // Regular
  1: 'Provoz jednou denně', // OnceDaily
  2: 'Sezónní provoz', // Seasonal
  3: 'Provoz jednou týdně', // OnceWeekly
  4: 'Provoz o pracovních dnech', // Weekdays
  5: 'Provoz o víkendech', // Weekends
  6: 'Provoz při zvláštních příležitostech' // Special
};

interface RailwayMapProps {
  className?: string;
  geoJsonData: GeoJSONFeatureCollection;
}

export default function RailwayMap({ className = '', geoJsonData }: RailwayMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Initialize map centered on Czech Republic/Austria border region
    const map = L.map(mapRef.current).setView([49.2, 14.5], 7);

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    mapInstanceRef.current = map;

    // Create layer groups for different zoom levels
    const stationLayerGroup = L.layerGroup();
    const railwayLayerGroup = L.layerGroup();

    // Add layer groups to map
    railwayLayerGroup.addTo(map);

    // Display GeoJSON data
    if (geoJsonData) {
      L.geoJSON(geoJsonData, {
        pointToLayer: (feature, latlng) => {
          // Create small circle markers for stations instead of default markers
          return L.circleMarker(latlng, {
            radius: 4,
            fillColor: '#ff7800',
            color: '#000',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8
          });
        },
        style: (feature) => {
          // Only style LineString features (railway lines)
          if (feature?.geometry?.type === 'LineString') {
            // Dynamic weight logic: thinner (2) for Special usage, normal (3) otherwise
            const isSpecial = feature.properties.usage.includes(6);
            const weight = isSpecial ? 2 : 3;

            return {
              color: feature.properties.custom.last_ride ? 'DarkGreen' : 'Crimson',
              weight: weight,
              opacity: 0.8,
              fillOpacity: 0.6
            };
          }
          return {};
        },
        onEachFeature: (feature, layer) => {
          // Add to appropriate layer group based on geometry type
          if (feature.geometry.type === 'Point') {
            stationLayerGroup.addLayer(layer);
          } else {
            railwayLayerGroup.addLayer(layer);
          }

          // Add popup with railway information
          if (feature.properties) {
            const props = feature.properties as GeoJSONFeature["properties"];
            let popupContent = `<div class="railway-popup">`;

            if (props.name) {
              popupContent += `<h3 class="font-bold text-lg mb-2">${props.name}</h3>`;
            }

            if (feature.geometry.type === 'LineString') {
              const usage = props.usage!.map((type: number) => usageMap[type]).join(', ');
              let formattedDescription = `<i>${usage}, ${props.primary_operator}</i>`
              if (props.description) {
                formattedDescription += `<br /><br />${props.description}`;
              }

              if (props.custom?.last_ride) {
                formattedDescription += `<br /><br />Naposledy projeto: ${new Intl.DateTimeFormat("cs-CZ").format(props.custom.last_ride)}`;
              }
              if (props.custom?.note) {
                formattedDescription += `<br /><br />${props.custom.note}`;
              }
              popupContent += `<div class="mb-2">${formattedDescription}</div>`;
            }

            popupContent += `</div>`;

            layer.bindPopup(popupContent);
          }
        }
      });

      // Add zoom-based visibility for stations
      const handleZoomEnd = () => {
        const currentZoom = map.getZoom();
        if (currentZoom >= 10) {
          // Show stations at zoom level 10 and above
          if (!map.hasLayer(stationLayerGroup)) {
            map.addLayer(stationLayerGroup);
          }
        } else {
          // Hide stations at lower zoom levels
          if (map.hasLayer(stationLayerGroup)) {
            map.removeLayer(stationLayerGroup);
          }
        }
      };

      // Set initial station visibility
      handleZoomEnd();

      // Listen for zoom changes
      map.on('zoomend', handleZoomEnd);
    }

    // Cleanup function
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [geoJsonData]);

  return (
    <div
      ref={mapRef}
      className={`w-full h-full ${className}`}
      style={{ height: '100%', minHeight: '400px' }}
    />
  );
}
