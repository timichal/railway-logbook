'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { getAllAdminNotes, updateAdminNote } from '@/lib/adminNotesActions';
import { noteTypeOptions, getNoteTypeColor, type NoteType } from '@/lib/constants';
import { useToast } from '@/lib/toast';
import type { AdminNote } from '@/lib/types';

type TypeFilter = NoteType | 'none' | 'all';

interface AdminNotesTabProps {
  onFocusNote?: (coordinate: [number, number]) => void;
  onNoteChanged?: () => void; // Tells parent to refresh map tile cache
  refreshSignal?: number; // Parent bumps this to force a reload (e.g. after popup edits)
}

export default function AdminNotesTab({ onFocusNote, onNoteChanged, refreshSignal }: AdminNotesTabProps) {
  const { showError, showSuccess } = useToast();
  const [notes, setNotes] = useState<AdminNote[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [savingId, setSavingId] = useState<number | null>(null);

  const loadNotes = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await getAllAdminNotes();
      setNotes(data);
    } catch (error) {
      showError(`Failed to load notes: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes, refreshSignal]);

  const counts = useMemo(() => {
    const c = { all: notes.length, none: 0 } as Record<TypeFilter, number>;
    for (const opt of noteTypeOptions) c[opt.id] = 0;
    for (const n of notes) {
      if (!n.note_type) c.none++;
      else c[n.note_type]++;
    }
    return c;
  }, [notes]);

  const filteredNotes = useMemo(() => {
    if (filter === 'all') return notes;
    if (filter === 'none') return notes.filter((n) => !n.note_type);
    return notes.filter((n) => n.note_type === filter);
  }, [notes, filter]);

  const handleTypeChange = async (note: AdminNote, newType: NoteType) => {
    setSavingId(note.id);
    try {
      const updated = await updateAdminNote(note.id, note.text, newType);
      setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
      showSuccess('Note type updated');
      onNoteChanged?.();
    } catch (error) {
      showError(`Failed to update type: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSavingId(null);
    }
  };

  const filterButton = (key: TypeFilter, label: string, color?: string) => {
    const active = filter === key;
    const count = counts[key] ?? 0;
    return (
      <button
        key={key}
        onClick={() => setFilter(key)}
        className={`px-2 py-1 text-xs rounded border flex items-center gap-1.5 ${
          active
            ? 'bg-blue-100 border-blue-500 text-blue-800'
            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
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
          {filterButton('all', 'All')}
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
            {filteredNotes.map((note) => (
              <li
                key={note.id}
                className="p-3 hover:bg-gray-50 cursor-pointer"
                onClick={() => onFocusNote?.(note.coordinate)}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="inline-block w-3 h-3 rounded-full border border-gray-700 mt-1 flex-shrink-0"
                    style={{ backgroundColor: getNoteTypeColor(note.note_type) }}
                    title={note.note_type}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 whitespace-pre-wrap break-words">
                      {note.text}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-500">
                      <label
                        className="text-gray-600"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Type:
                      </label>
                      <select
                        value={note.note_type ?? ''}
                        disabled={savingId === note.id}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const v = e.target.value as NoteType | '';
                          if (v) handleTypeChange(note, v);
                        }}
                        className="text-xs px-1.5 py-0.5 border border-gray-300 rounded bg-white text-gray-800"
                      >
                        {!note.note_type && <option value="">-- none --</option>}
                        {noteTypeOptions.map((opt) => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </select>
                      <span className="ml-auto">
                        {new Date(note.updated_at).toISOString().slice(0, 10)}
                      </span>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
