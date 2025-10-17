import { useEffect, useState } from 'react';
import type { RailwayPart } from '@/lib/types';
import { getRailwayRoute } from '@/lib/railway-actions';
import { calculateRouteLength } from '../utils/distance';

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

  // Calculate total length of preview route
  useEffect(() => {
    if (!previewRoute || !previewRoute.railwayParts || previewRoute.railwayParts.length === 0) {
      setPreviewLength(null);
      return;
    }

    const totalLength = calculateRouteLength(previewRoute.railwayParts);
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
