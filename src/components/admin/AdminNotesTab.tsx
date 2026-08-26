"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getAllAdminNotes, updateAdminNote } from "@/lib/adminNotesActions";
import { getNoteTypeColor, type NoteType, noteTypeOptions } from "@/lib/constants";
import { useRegionId } from "@/lib/regionContext";
import { useToast } from "@/lib/toast";
import type { AdminNote } from "@/lib/types";
import { btn } from "@/lib/ui/buttonStyles";

type TypeFilter = NoteType | "all";

interface AdminNotesTabProps {
  onFocusNote?: (coordinate: [number, number]) => void;
  onNoteChanged?: () => void; // Tells parent to refresh map tile cache
  refreshSignal?: number; // Parent bumps this to force a reload (e.g. after popup edits)
}

export default function AdminNotesTab({
  onFocusNote,
  onNoteChanged,
  refreshSignal,
}: AdminNotesTabProps) {
  const regionId = useRegionId();
  const { showError, showSuccess } = useToast();
  const [notes, setNotes] = useState<AdminNote[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [savingId, setSavingId] = useState<number | null>(null);

  const loadNotes = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await getAllAdminNotes(regionId);
      setNotes(data);
    } catch (error) {
      showError(
        `Failed to load notes: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsLoading(false);
    }
  }, [showError, regionId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshSignal is a trigger prop; bumping it must re-run the effect to reload notes even though it isn't read in the body.
  useEffect(() => {
    loadNotes();
  }, [loadNotes, refreshSignal]);

  const counts = useMemo(() => {
    const c = { all: notes.length } as Record<TypeFilter, number>;
    for (const opt of noteTypeOptions) c[opt.id] = 0;
    for (const n of notes) c[n.note_type]++;
    return c;
  }, [notes]);

  const filteredNotes = useMemo(() => {
    if (filter === "all") return notes;
    return notes.filter((n) => n.note_type === filter);
  }, [notes, filter]);

  const handleTypeChange = async (note: AdminNote, newType: NoteType) => {
    setSavingId(note.id);
    try {
      const updated = await updateAdminNote(note.id, note.text, newType, note.source);
      setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
      showSuccess("Note type updated");
      onNoteChanged?.();
    } catch (error) {
      showError(
        `Failed to update type: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setSavingId(null);
    }
  };

  const filterButton = (key: TypeFilter, label: string, color?: string) => {
    const active = filter === key;
    const count = counts[key] ?? 0;
    return (
      <button
        type="button"
        key={key}
        onClick={() => setFilter(key)}
        className={`${btn(active ? "softPrimary" : "outline", "xs")} ${
          active ? "border border-blue-500" : ""
        }`}
      >
        {color && (
          <span
            className="inline-block w-2.5 h-2.5 rounded-full border border-gray-400"
            style={{ backgroundColor: color }}
          />
        )}
        <span>{label}</span>
        <span className="text-gray-500">({count})</span>
      </button>
    );
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-gray-200 flex-shrink-0 bg-gray-50">
        <div className="flex flex-wrap gap-1.5">
          {filterButton("all", "All")}
          {noteTypeOptions.map((opt) => filterButton(opt.id, opt.label, opt.color))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && notes.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">Loading notes...</div>
        ) : filteredNotes.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No notes match this filter.</div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {/* `:active` reaches an ancestor while its descendant is pressed, so the row
                lights up from the button inside it. */}
            {filteredNotes.map((note) => (
              <li
                key={note.id}
                className="p-3 transition-colors hover:bg-gray-50 active:bg-gray-100"
              >
                <button
                  type="button"
                  onClick={() => onFocusNote?.(note.coordinate)}
                  className="w-full text-left flex items-start gap-2"
                >
                  <span
                    className="inline-block w-3 h-3 rounded-full border border-gray-700 mt-1 flex-shrink-0"
                    style={{ backgroundColor: getNoteTypeColor(note.note_type) }}
                    title={note.note_type}
                  />
                  <span className="flex-1 min-w-0 text-sm text-gray-900 whitespace-pre-wrap break-words">
                    {note.text}
                  </span>
                </button>
                <div className="mt-1.5 ml-5 flex items-center gap-2 text-xs text-gray-500">
                  <label htmlFor={`note-${note.id}-type`} className="text-gray-600">
                    Type:
                  </label>
                  <select
                    id={`note-${note.id}-type`}
                    value={note.note_type}
                    disabled={savingId === note.id}
                    onChange={(e) => handleTypeChange(note, e.target.value as NoteType)}
                    className="text-xs px-1.5 py-0.5 border border-gray-300 rounded bg-surface text-gray-800"
                  >
                    {noteTypeOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <span className="ml-auto">
                    {new Date(note.updated_at).toISOString().slice(0, 10)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
