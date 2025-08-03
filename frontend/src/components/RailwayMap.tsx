'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { GeoJSONFeatureCollection } from '@/lib/types';

// Fix for default markers in Leaflet with Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

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
              const color = feature?.properties?._umap_options?.color || '#0066ff';
              let weight = feature?.properties?._umap_options?.weight || 3;
              
              // Make special usage lines thinner
              if (feature?.properties?.description?.includes('Provoz při zvláštních příležitostech')) {
                weight = Math.max(1, weight - 1); // Reduce weight by 1, minimum 1
              }
              
              return {
                color: color,
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
              const props = feature.properties;
              let popupContent = `<div class="railway-popup">`;
              
              if (props.name) {
                popupContent += `<h3 class="font-bold text-lg mb-2">${props.name}</h3>`;
              }
              
              if (props.description) {
                // Format the description to handle last_ride and notes better
                let formattedDescription = props.description;
                
                // Extract and format "Naposledy projeto" (last ride) information
                const lastRideMatch = formattedDescription.match(/Naposledy projeto: (\d{4}-\d{2}-\d{2})/);
                if (lastRideMatch) {
                  const lastRideDate = new Date(lastRideMatch[1]).toLocaleDateString('cs-CZ');
                  formattedDescription = formattedDescription.replace(
                    /Naposledy projeto: \d{4}-\d{2}-\d{2}/,
                    `<strong>Naposledy projeto:</strong> ${lastRideDate}`
                  );
                }
                
                // Format notes in asterisks to be more prominent
                formattedDescription = formattedDescription.replace(
                  /\*([^*]+)\*/g,
                  '<em class="text-blue-600">$1</em>'
                );
                
                // Convert line breaks to HTML
                formattedDescription = formattedDescription.replace(/\n/g, '<br>');
                
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
