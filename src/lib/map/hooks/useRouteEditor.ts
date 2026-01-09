import { useState, useCallback } from 'react';
import type maplibreglType from 'maplibre-gl';
import type { DataAccess } from '@/lib/dataAccess';
import type { UserProgress } from '@/lib/userActions';
import { getUserRouteColorExpression } from '../utils/userRouteStyling';

/**
 * Simplified hook for progress tracking
 * Trip management has been replaced with journey-based system
 */
export function useRouteEditor(
  dataAccess: DataAccess,
  map: React.MutableRefObject<maplibreglType.Map | null>,
  selectedCountries?: string[]
) {
  const [cacheBuster, setCacheBuster] = useState(Date.now());
  const [progress, setProgress] = useState<UserProgress | null>(null);
  const [showSpecialLines, setShowSpecialLines] = useState(false);

  // Refresh progress stats
  const refreshProgress = useCallback(async () => {
    try {
      const progressData = await dataAccess.getUserProgress(selectedCountries);
      setProgress(progressData);
    } catch (error) {
      console.error('Error refreshing progress:', error);
    }
  }, [dataAccess, selectedCountries]);

  const toggleShowSpecialLines = useCallback(() => {
    if (!map.current) return;

    const newShowSpecialLines = !showSpecialLines;
    setShowSpecialLines(newShowSpecialLines);

    // Update visibility filter for railway_routes layer
    if (map.current.getLayer('railway_routes')) {
      const colorExpression = getUserRouteColorExpression();
      map.current.setPaintProperty('railway_routes', 'line-color', colorExpression);

      const newFilter = newShowSpecialLines
        ? undefined // Show all routes
        : ['!=', ['get', 'usage_type'], 1]; // Hide Special routes (usage_type=1)

      map.current.setFilter('railway_routes', newFilter as any);
    }

    // Update visibility filter for scenic outline layer
    if (map.current.getLayer('railway_routes_scenic_outline')) {
      const newFilter = newShowSpecialLines
        ? ['==', ['get', 'scenic'], true] // Show all scenic routes
        : ['all', ['==', ['get', 'scenic'], true], ['!=', ['get', 'usage_type'], 1]]; // Hide Special scenic routes

      map.current.setFilter('railway_routes_scenic_outline', newFilter as any);
    }
  }, [map, showSpecialLines]);

  return {
    refreshProgress,
    progress,
    showSpecialLines,
    toggleShowSpecialLines,
    cacheBuster
  };
}
