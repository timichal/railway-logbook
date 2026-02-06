import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl from 'maplibre-gl';
import { getAdminNote } from '@/lib/adminNotesActions';
import { createAdminNotesSource, createAdminNotesLayer } from '../index';
import NotesPopup from '@/components/NotesPopup';

interface UseAdminNotesPopupOptions {
  map: React.MutableRefObject<maplibregl.Map | null>;
  mapLoaded: boolean;
  showNotesLayer: boolean;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
}

/**
 * Manages the right-click notes popup system on the admin map:
 * - Right-click to create/edit notes
 * - Click outside to close popup
 * - Notes layer cache busting on save/delete
 */
export function useAdminNotesPopup({
  map,
  mapLoaded,
  showNotesLayer,
  showSuccess,
  showError,
}: UseAdminNotesPopupOptions) {
  const [notesCacheBuster, setNotesCacheBuster] = useState(Date.now());
  const notesPopupRef = useRef<maplibregl.Popup | null>(null);

  // Right-click handler for notes
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const handleRightClick = async (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();

      const coordinate: [number, number] = [e.lngLat.lng, e.lngLat.lat];

      // Check if clicking on an existing note
      const noteFeatures = map.current!.queryRenderedFeatures(e.point, {
        layers: ['admin_notes'],
      });

      let noteId: number | null = null;
      let noteText = '';

      if (noteFeatures && noteFeatures.length > 0) {
        noteId = noteFeatures[0].properties?.id;
        if (noteId) {
          try {
            const note = await getAdminNote(noteId);
            if (note) {
              noteText = note.text;
            }
          } catch (error) {
            console.error('Failed to load note:', error);
            return;
          }
        }
      }

      // Close existing popup if any
      if (notesPopupRef.current) {
        notesPopupRef.current.remove();
      }

      const popupContainer = document.createElement('div');

      // Dynamic anchor based on click position
      const clickY = e.point.y;
      const mapHeight = map.current!.getContainer().clientHeight;
      const anchor = clickY < mapHeight * 0.3 ? 'top' : 'bottom';

      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        maxWidth: 'none',
        anchor,
        offset: 15,
      })
        .setLngLat(e.lngLat)
        .setDOMContent(popupContainer)
        .addTo(map.current!);

      notesPopupRef.current = popup;

      const root = createRoot(popupContainer);

      const handleClose = () => {
        popup.remove();
        notesPopupRef.current = null;
        root.unmount();
      };

      const handleSaved = () => {
        setNotesCacheBuster(Date.now());
      };

      root.render(
        <NotesPopup
          noteId={noteId}
          initialText={noteText}
          coordinate={coordinate}
          onClose={handleClose}
          onSaved={handleSaved}
          showSuccess={showSuccess}
          showError={showError}
        />
      );
    };

    // Click outside popup to close
    const handleMapClick = (e: maplibregl.MapMouseEvent) => {
      if (!notesPopupRef.current) return;

      const noteFeatures = map.current!.queryRenderedFeatures(e.point, {
        layers: ['admin_notes'],
      });
      if (noteFeatures && noteFeatures.length > 0) return;

      const popupElement = notesPopupRef.current.getElement();
      if (popupElement && e.originalEvent.target instanceof Node) {
        if (popupElement.contains(e.originalEvent.target as Node)) return;
      }

      notesPopupRef.current.remove();
      notesPopupRef.current = null;
    };

    map.current.on('contextmenu', handleRightClick);
    map.current.on('click', handleMapClick);

    return () => {
      if (map.current) {
        map.current.off('contextmenu', handleRightClick);
        map.current.off('click', handleMapClick);
      }
      if (notesPopupRef.current) {
        notesPopupRef.current.remove();
        notesPopupRef.current = null;
      }
    };
  }, [mapLoaded, map, showSuccess, showError]);

  // Refresh notes layer when cache buster changes
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const hasNotesLayer = map.current.getLayer('admin_notes');
    const hasNotesSource = map.current.getSource('admin_notes');

    if (!hasNotesLayer && !hasNotesSource) return; // Initial load, layers not ready yet

    if (hasNotesLayer) map.current.removeLayer('admin_notes');
    if (hasNotesSource) map.current.removeSource('admin_notes');

    map.current.addSource('admin_notes', createAdminNotesSource(notesCacheBuster));
    map.current.addLayer(createAdminNotesLayer());

    map.current.setLayoutProperty(
      'admin_notes',
      'visibility',
      showNotesLayer ? 'visible' : 'none',
    );

    map.current.triggerRepaint();
  }, [notesCacheBuster, mapLoaded, map, showNotesLayer]);
}
