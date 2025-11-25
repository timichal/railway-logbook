import { useEffect, useState } from 'react';
import type { RailwayPart } from '@/lib/types';
import { getRailwayRoute } from '@/lib/adminRouteActions';
import { calculateDistance } from '../utils/distance';

interface PreviewRoute {
  partIds: string[];
  coordinates: [number, number][];
  railwayParts?: RailwayPart[];
}

/**
 * Hook to manage route length calculations for preview and selected routes
 */
export function useRouteLength(
  previewRoute: PreviewRoute | null | undefined,
  selectedRouteId: string | null | undefined
) {
  const [previewLength, setPreviewLength] = useState<number | null>(null);
  const [selectedRouteLength, setSelectedRouteLength] = useState<number | null>(null);

  // Calculate total length of preview route using truncated coordinates
  // This ensures preview matches the saved length (which uses truncated coordinates)
  useEffect(() => {
    if (!previewRoute || !previewRoute.coordinates || previewRoute.coordinates.length < 2) {
      setPreviewLength(null);
      return;
    }

    // Calculate distance from truncated coordinates (matching database calculation)
    let totalLength = 0;
    for (let i = 0; i < previewRoute.coordinates.length - 1; i++) {
      totalLength += calculateDistance(previewRoute.coordinates[i], previewRoute.coordinates[i + 1]);
    }
    setPreviewLength(totalLength);
  }, [previewRoute]);

  // Fetch selected route length from database
  useEffect(() => {
    if (!selectedRouteId) {
      setSelectedRouteLength(null);
      return;
    }

    const fetchRouteLength = async () => {
      try {
        const route = await getRailwayRoute(selectedRouteId);
        setSelectedRouteLength(route.length_km ? parseFloat(route.length_km) : null);
      } catch (error) {
        console.error('Error fetching route length:', error);
        setSelectedRouteLength(null);
      }
    };

    fetchRouteLength();
  }, [selectedRouteId]);

  return { previewLength, selectedRouteLength };
}
