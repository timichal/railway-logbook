'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createAdminNote, updateAdminNote, deleteAdminNote } from '@/lib/adminNotesActions';
import { noteTypeOptions, type NoteType } from '@/lib/constants';

interface NotesPopupProps {
  noteId?: number | null; // If set, editing existing note; if null, creating new note
  initialText?: string;
  initialNoteType?: NoteType | null;
  updatedAt?: string; // ISO timestamp of last update (existing notes only)
  coordinate: [number, number]; // [lng, lat]
  onClose: () => void;
  onSaved: () => void; // Callback after save/delete to refresh map
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
}

/**
 * Popup component for creating/editing admin notes
 * Shown on right-click on admin map
 */
export default function NotesPopup({
  noteId,
  initialText = '',
  initialNoteType = null,
  updatedAt,
  coordinate,
  onClose,
  onSaved,
  showSuccess,
  showError
}: NotesPopupProps) {
  const [text, setText] = useState(initialText);
  const [noteType, setNoteType] = useState<NoteType | ''>(initialNoteType ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Type is required for new notes; for existing notes, allow clearing is not exposed in UI
  // but we still require selecting a type before saving edits (once one is set, picker can't go back to empty).
  const canSave = !!text.trim() && !!noteType;

  const handleSave = async () => {
    if (!text.trim()) {
      showError('Note text cannot be empty');
      return;
    }
    if (!noteType) {
      showError('Please select a note type');
      return;
    }

    setIsSaving(true);
    try {
      if (noteId) {
        await updateAdminNote(noteId, text.trim(), noteType);
        showSuccess('Note updated successfully');
      } else {
        await createAdminNote(coordinate, text.trim(), noteType);
        showSuccess('Note created successfully');
      }
      onSaved();
      onClose();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to save note');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!noteId) return;

    setIsDeleting(true);
    try {
      await deleteAdminNote(noteId);
      showSuccess('Note deleted successfully');
      onSaved();
      onClose();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to delete note');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="w-64 bg-white">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">
            {noteId ? 'Edit Note' : 'New Note'}
          </h3>
          {noteId && updatedAt && (
            <div className="text-xs text-gray-500 mt-0.5">
              Last updated {new Date(updatedAt).toISOString().replace('T', ' ').slice(0, 19)}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 text-lg leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <label className="block text-xs font-medium text-gray-700 mb-1">
        Type <span className="text-red-500">*</span>
      </label>
      <select
        value={noteType}
        onChange={(e) => setNoteType(e.target.value as NoteType | '')}
        className="w-full px-2 py-1 mb-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-white"
      >
        <option value="">-- Select type --</option>
        {noteTypeOptions.map((opt) => (
          <option key={opt.id} value={opt.id}>{opt.label}</option>
        ))}
      </select>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter note text..."
        className="w-full h-24 px-2 py-1 text-sm border border-gray-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
      />

      <div className="flex gap-2 mt-2">
        <button
          onClick={handleSave}
          disabled={isSaving || !canSave}
          className="flex-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>

        {noteId && (
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        )}
      </div>

      <div className="mt-2 text-xs text-gray-500">
        <kbd className="px-1 py-0.5 bg-gray-100 border border-gray-300 rounded">Ctrl+Enter</kbd> to save,{' '}
        <kbd className="px-1 py-0.5 bg-gray-100 border border-gray-300 rounded">Esc</kbd> to close
      </div>
    </div>
  );
}
