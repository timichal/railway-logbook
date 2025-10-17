import { useState } from 'react';
import type maplibreglType from 'maplibre-gl';
import { updateUserRailwayData, getUserProgress, type UserProgress } from '@/lib/railway-actions';
import { createRailwayRoutesSource, createRailwayRoutesLayer, closeAllPopups } from '@/lib/map';
import { getUserRouteColorExpression, getUserRouteWidthExpression } from '../utils/userRouteStyling';

interface EditingFeature {
  track_id: string;
  name: string;
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

  // Open edit form with route data
  const openEditForm = (feature: EditingFeature) => {
    setEditingFeature(feature);
    setDate(feature.date ? new Date(feature.date).toISOString().split('T')[0] : '');
    setNote(feature.note || '');
    setPartial(feature.partial || false);
    setShowEditForm(true);
  };

  // Close edit form
  const closeEditForm = () => {
    closeAllPopups();
    setShowEditForm(false);
    setEditingFeature(null);
  };

  // Submit form and update route data
  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFeature?.track_id) return;

    setIsLoading(true);
    try {
      await updateUserRailwayData(editingFeature.track_id, date || null, note || null, partial);

      // Update cache buster to force tile reload
      const newCacheBuster = Date.now();
      setCacheBuster(newCacheBuster);

      // Refresh the map by reloading the railway routes layer with cache buster
      if (map.current) {
        const source = map.current.getSource('railway_routes');
        if (source) {
          // Force reload by removing and re-adding the source with new cache buster
          map.current.removeLayer('railway_routes');
          map.current.removeSource('railway_routes');

          map.current.addSource('railway_routes', createRailwayRoutesSource({ userId, cacheBuster: newCacheBuster }));

          map.current.addLayer(
            createRailwayRoutesLayer({
              colorExpression: getUserRouteColorExpression(),
              widthExpression: getUserRouteWidthExpression(),
            }),
            'stations'
          );

          // Wait for the source to load new tiles before closing the form
          await new Promise<void>((resolve) => {
            const checkSourceLoaded = () => {
              const newSource = map.current?.getSource('railway_routes');
              if (newSource) {
                setTimeout(() => resolve(), 300);
              } else {
                resolve();
              }
            };

            map.current?.once('sourcedata', checkSourceLoaded);
            setTimeout(() => resolve(), 500);
          });
        }
      }

      closeEditForm();

      // Refresh progress stats
      try {
        const progressData = await getUserProgress();
        setProgress(progressData);
      } catch (error) {
        console.error('Error refreshing progress:', error);
      }
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
    openEditForm,
    closeEditForm,
    submitForm,
    fetchProgress,
  };
}
