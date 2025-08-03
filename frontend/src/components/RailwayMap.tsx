'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default markers in Leaflet with Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface RailwayMapProps {
  className?: string;
}

export default function RailwayMap({ className = '' }: RailwayMapProps) {
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
    
    // Load and display GeoJSON data
    fetch('/merged-only.geojson')
      .then(response => response.json())
      .then(data => {
        L.geoJSON(data, {
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
              const weight = feature?.properties?._umap_options?.weight || 3;
              
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
                popupContent += `<p class="mb-2">${props.description}</p>`;
              }
              
              if (props.track_id) {
                popupContent += `<p class="text-sm text-gray-600"><strong>Track ID:</strong> ${props.track_id}</p>`;
              }
              
              if (props.railway) {
                popupContent += `<p class="text-sm text-gray-600"><strong>Railway Type:</strong> ${props.railway}</p>`;
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
      })
      .catch(error => {
        console.error('Error loading railway data:', error);
      });

    // Cleanup function
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div 
      ref={mapRef} 
      className={`w-full h-full ${className}`}
      style={{ height: '100%', minHeight: '400px' }}
    />
  );
}