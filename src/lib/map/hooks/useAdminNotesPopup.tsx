import * as maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import NotesPopup from "@/components/admin/NotesPopup";
import { unwrap } from "@/lib/actionResult";
import { getAdminNote } from "@/lib/adminNotesActions";
import type { NoteType } from "@/lib/shared/constants";
import type { AdminNote } from "@/lib/shared/types";

interface UseAdminNotesPopupOptions {
  map: React.MutableRefObject<maplibregl.Map | null>;
  mapLoaded: boolean;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  /** Called after a popup save/delete; the parent refreshes the notes tiles. */
  onNotesChanged: () => void;
}

/**
 * Manages the right-click notes popup system on the admin map:
 * - Right-click to create/edit notes
 * - Click outside to close popup
 */
export function useAdminNotesPopup({
  map,
  mapLoaded,
  showSuccess,
  showError,
  onNotesChanged,
}: UseAdminNotesPopupOptions) {
  const notesPopupRef = useRef<maplibregl.Popup | null>(null);

  // Right-click handler for notes
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapLoaded) return;

    // A right-click on a note waits for the note before opening its popup. Only the
    // latest click may open one — a newer right-click replaces it, and a left-click
    // cancels it — and none may once this effect is torn down. A slow fetch would
    // otherwise open a popup over a newer one, after the admin clicked away, or on
    // a map that is gone.
    let latestClick = 0;
    let disposed = false;

    const handleRightClick = async (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      const clickId = ++latestClick;

      const coordinate: [number, number] = [e.lngLat.lng, e.lngLat.lat];

      // Check if clicking on an existing note
      const noteFeatures = mapInstance.queryRenderedFeatures(e.point, {
        layers: ["admin_notes"],
      });

      let noteId: number | null = null;
      let noteText = "";
      let noteUpdatedAt: string | undefined;
      let noteTypeValue: NoteType | null = null;
      let noteSource: string | null = null;

      if (noteFeatures && noteFeatures.length > 0) {
        noteId = noteFeatures[0].properties?.id;
        if (noteId) {
          let note: AdminNote | null;
          try {
            note = unwrap(await getAdminNote(noteId));
          } catch (error) {
            console.error("Failed to load note:", error);
            if (!disposed && clickId === latestClick) showError("Failed to load note");
            return;
          }
          if (disposed || clickId !== latestClick) return;
          // A note deleted a moment ago is still drawn until its tile reloads (the
          // refresh keeps the old tile on screen meanwhile). Opening it would offer
          // an empty form that saves over a row that no longer exists.
          if (!note) {
            showError("This note has been deleted");
            return;
          }
          noteText = note.text;
          noteUpdatedAt = note.updated_at;
          noteTypeValue = note.note_type;
          noteSource = note.source;
        }
      }

      // Close existing popup if any
      notesPopupRef.current?.remove();

      const popupContainer = document.createElement("div");

      // Dynamic anchor based on click position
      const clickY = e.point.y;
      const mapHeight = mapInstance.getContainer().clientHeight;
      const anchor = clickY < mapHeight * 0.3 ? "top" : "bottom";

      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        maxWidth: "none",
        anchor,
        offset: 15,
      });
      const root = createRoot(popupContainer);

      // Every way a popup ends — its own Close/Esc, a click outside, a newer
      // right-click, this effect's cleanup, the map being removed — goes through
      // `remove()`, which fires "close" exactly once. The unmount is deferred for
      // the cleanup path: that runs during AdminMap's commit, and React refuses to
      // unmount a root synchronously while it is already rendering.
      popup.on("close", () => {
        if (notesPopupRef.current === popup) notesPopupRef.current = null;
        queueMicrotask(() => root.unmount());
      });

      popup.setLngLat(e.lngLat).setDOMContent(popupContainer).addTo(mapInstance);
      notesPopupRef.current = popup;

      root.render(
        <NotesPopup
          noteId={noteId}
          initialText={noteText}
          initialNoteType={noteTypeValue}
          initialSource={noteSource}
          updatedAt={noteUpdatedAt}
          coordinate={coordinate}
          onClose={() => popup.remove()}
          onSaved={onNotesChanged}
          showSuccess={showSuccess}
          showError={showError}
        />,
      );
    };

    // Click outside popup to close
    const handleMapClick = (e: maplibregl.MapMouseEvent) => {
      latestClick++;
      if (!notesPopupRef.current) return;

      const noteFeatures = mapInstance.queryRenderedFeatures(e.point, {
        layers: ["admin_notes"],
      });
      if (noteFeatures && noteFeatures.length > 0) return;

      const popupElement = notesPopupRef.current.getElement();
      if (popupElement && e.originalEvent.target instanceof Node) {
        if (popupElement.contains(e.originalEvent.target as Node)) return;
      }

      notesPopupRef.current.remove();
    };

    mapInstance.on("contextmenu", handleRightClick);
    mapInstance.on("click", handleMapClick);

    return () => {
      disposed = true;
      mapInstance.off("contextmenu", handleRightClick);
      mapInstance.off("click", handleMapClick);
      notesPopupRef.current?.remove();
    };
  }, [mapLoaded, map, showSuccess, showError, onNotesChanged]);
}
