import { useState, useCallback } from 'react';
import type maplibreglType from 'maplibre-gl';
import {
  getUserTrips,
  addUserTrip,
  updateUserTrip,
  deleteUserTrip,
  getUserProgress,
  quickLogRoute,
  type UserProgress,
  type UserTrip
} from '@/lib/user-actions';
import type { SelectedRoute } from '@/lib/types';
import { createRailwayRoutesSource, createRailwayRoutesLayer, closeAllPopups } from '@/lib/map';
import { getUserRouteColorExpression, getUserRouteWidthExpression } from '../utils/userRouteStyling';
import { useToast } from '@/lib/toast';

/**
 * Hook to manage route editing and trips management
 */
export function useRouteEditor(userId: number, map: React.MutableRefObject<maplibreglType.Map | null>) {
  const { showSuccess, showError } = useToast();
  const [editingFeature, setEditingFeature] = useState<SelectedRoute | null>(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [trips, setTrips] = useState<UserTrip[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cacheBuster, setCacheBuster] = useState(Date.now());
  const [progress, setProgress] = useState<UserProgress | null>(null);
  const [showSpecialLines, setShowSpecialLines] = useState(false);

  // Open edit form with route data and fetch all trips
  const openEditForm = useCallback(async (feature: SelectedRoute) => {
    setEditingFeature(feature);
    setShowEditForm(true);

    // Fetch all trips for this route
    try {
      const tripsData = await getUserTrips(feature.track_id);
      setTrips(tripsData);
    } catch (error) {
      console.error('Error fetching trips:', error);
      setTrips([]);
    }

    // Highlight selected route with increased width
    if (map.current && map.current.getLayer('railway_routes')) {
      map.current.setPaintProperty('railway_routes', 'line-width', [
        'case',
        ['==', ['get', 'track_id'], parseInt(feature.track_id)],
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
    }
  }, [map]);

  // Close edit form
  const closeEditForm = useCallback(() => {
    closeAllPopups();
    setShowEditForm(false);
    setEditingFeature(null);
    setTrips([]);

    // Reset route width styling to default
    if (map.current && map.current.getLayer('railway_routes')) {
      map.current.setPaintProperty('railway_routes', 'line-width', getUserRouteWidthExpression());
    }
  }, [map]);

  // Refresh map and progress stats
  const refreshMapAndProgress = async () => {
    // Refresh progress stats
    try {
      const progressData = await getUserProgress();
      setProgress(progressData);
    } catch (error) {
      console.error('Error refreshing progress:', error);
    }

    // Update cache buster to force tile reload
    const newCacheBuster = Date.now();
    setCacheBuster(newCacheBuster);

    if (map.current && map.current.getSource('railway_routes')) {
      // Remove dependent layers first
      const dependentLayers = ['selected_routes_highlight', 'highlighted_routes'];
      dependentLayers.forEach(layerId => {
        if (map.current && map.current.getLayer(layerId)) {
          map.current.removeLayer(layerId);
        }
      });

      // Now remove the main layer and source
      map.current.removeLayer('railway_routes');
      map.current.removeSource('railway_routes');

      // Re-add source and layer
      map.current.addSource('railway_routes', createRailwayRoutesSource({ userId, cacheBuster: newCacheBuster }));
      map.current.addLayer(
        createRailwayRoutesLayer({
          colorExpression: getUserRouteColorExpression(),
          widthExpression: getUserRouteWidthExpression(),
          filter: showSpecialLines ? undefined : ['!=', ['get', 'usage_type'], 1], // Re-apply filter based on current state
        }),
        'stations'
      );

      // Re-apply selection highlighting if a route is being edited
      if (editingFeature) {
        map.current.setPaintProperty('railway_routes', 'line-width', [
          'case',
          ['==', ['get', 'track_id'], parseInt(editingFeature.track_id)],
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
      }
    }
  };

  // Add a new trip (inline from table row)
  const addTripInline = async (date: string, note: string | null, partial: boolean) => {
    if (!editingFeature?.track_id || !date) return;

    setIsLoading(true);
    try {
      await addUserTrip(editingFeature.track_id, date, note, partial);

      // Refresh trips list to get the new trip with ID
      const tripsData = await getUserTrips(editingFeature.track_id);
      setTrips(tripsData);

      await refreshMapAndProgress();
      showSuccess('Trip added!');
    } catch (error) {
      console.error('Error adding trip:', error);
      showError('Failed to add trip');
    } finally {
      setIsLoading(false);
    }
  };

  // Update an existing trip
  const updateTrip = async (tripId: number, date: string, note: string | null, partial: boolean) => {
    if (!editingFeature?.track_id) return;

    setIsLoading(true);
    try {
      await updateUserTrip(tripId, date, note, partial);

      // Update local state without re-fetching (maintains order)
      setTrips(prevTrips =>
        prevTrips.map(trip =>
          trip.id === tripId
            ? { ...trip, date, note, partial, updated_at: new Date().toISOString() }
            : trip
        )
      );

      await refreshMapAndProgress();
      showSuccess('Trip updated!');
    } catch (error) {
      console.error('Error updating trip:', error);
      showError('Failed to update trip');
    } finally {
      setIsLoading(false);
    }
  };

  // Delete a trip
  const deleteTrip = async (tripId: number) => {
    if (!editingFeature?.track_id) return;

    setIsLoading(true);
    try {
      await deleteUserTrip(tripId);

      // Refresh trips list
      const tripsData = await getUserTrips(editingFeature.track_id);
      setTrips(tripsData);

      await refreshMapAndProgress();
      showSuccess('Trip deleted successfully!');
    } catch (error) {
      console.error('Error deleting trip:', error);
      showError('Failed to delete trip');
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch initial progress
  const fetchProgress = async () => {
    try {
      const progressData = await getUserProgress();
      setProgress(progressData);
    } catch (error) {
      console.error('Error fetching progress:', error);
    }
  };

  // Quick log route with current date (returns callback for refresh)
  const quickLog = useCallback(async (trackId: string) => {
    try {
      await quickLogRoute(trackId);
    } catch (error) {
      console.error('Error quick logging route:', error);
    }
  }, []);

  // Refresh map after quick log (call this after delay)
  const refreshAfterQuickLog = useCallback(async () => {
    await refreshMapAndProgress();
  }, [editingFeature, userId, map, showSpecialLines]);

  return {
    editingFeature,
    showEditForm,
    trips,
    isLoading,
    cacheBuster,
    progress,
    showSpecialLines,
    setShowSpecialLines,
    openEditForm,
    closeEditForm,
    addTripInline,
    updateTrip,
    deleteTrip,
    fetchProgress,
    quickLog,
    refreshAfterQuickLog,
  };
}
