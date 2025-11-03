import { useState } from 'react';
import type maplibreglType from 'maplibre-gl';
import { updateUserRailwayData, getUserProgress, quickLogRoute, quickUnlogRoute, type UserProgress } from '@/lib/user-actions';
import { createRailwayRoutesSource, createRailwayRoutesLayer, closeAllPopups } from '@/lib/map';
import { getUserRouteColorExpression, getUserRouteWidthExpression } from '../utils/userRouteStyling';

interface EditingFeature {
  track_id: string;
  track_number: string | null;
  from_station: string;
  to_station: string;
  description: string;
  usage_types: string;
  date: string | null;
  note: string | null;
  partial: boolean | null;
}

/**
 * Hook to manage route editing and form state
 */
export function useRouteEditor(userId: number, map: React.MutableRefObject<maplibreglType.Map | null>) {
  const [editingFeature, setEditingFeature] = useState<EditingFeature | null>(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [partial, setPartial] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [cacheBuster, setCacheBuster] = useState(Date.now());
  const [progress, setProgress] = useState<UserProgress | null>(null);
  const [showSpecialLines, setShowSpecialLines] = useState(false);

  // Open edit form with route data
  const openEditForm = (feature: EditingFeature) => {
    setEditingFeature(feature);
    setDate(feature.date ? new Date(feature.date).toISOString().split('T')[0] : '');
    setNote(feature.note || '');
    setPartial(feature.partial || false);
    setShowEditForm(true);

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
  };

  // Close edit form
  const closeEditForm = () => {
    closeAllPopups();
    setShowEditForm(false);
    setEditingFeature(null);

    // Reset route width styling to default
    if (map.current && map.current.getLayer('railway_routes')) {
      map.current.setPaintProperty('railway_routes', 'line-width', getUserRouteWidthExpression());
    }
  };

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
      map.current.removeLayer('railway_routes');
      map.current.removeSource('railway_routes');
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

  // Submit form and update route data
  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFeature?.track_id) return;

    setIsLoading(true);
    try {
      await updateUserRailwayData(editingFeature.track_id, date || null, note || null, partial);
      await refreshMapAndProgress();
      closeEditForm();
    } catch (error) {
      console.error('Error updating railway data:', error);
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

  // Quick log route with current date (preserves note)
  const quickLog = async (trackId: string) => {
    try {
      await quickLogRoute(trackId);
      await refreshMapAndProgress();
    } catch (error) {
      console.error('Error quick logging route:', error);
    }
  };

  // Quick unlog route (remove date, preserves note)
  const quickUnlog = async (trackId: string) => {
    try {
      await quickUnlogRoute(trackId);
      await refreshMapAndProgress();
    } catch (error) {
      console.error('Error quick unlogging route:', error);
    }
  };

  return {
    editingFeature,
    showEditForm,
    date,
    setDate,
    note,
    setNote,
    partial,
    setPartial,
    isLoading,
    cacheBuster,
    progress,
    showSpecialLines,
    setShowSpecialLines,
    openEditForm,
    closeEditForm,
    submitForm,
    fetchProgress,
    quickLog,
    quickUnlog,
  };
}
