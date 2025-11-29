'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createAdminNote, updateAdminNote, deleteAdminNote } from '@/lib/adminNotesActions';

interface NotesPopupProps {
  noteId?: number | null; // If set, editing existing note; if null, creating new note
  initialText?: string;
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
  coordinate,
  onClose,
  onSaved,
  showSuccess,
  showError
}: NotesPopupProps) {
  const [text, setText] = useState(initialText);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSave = async () => {
    if (!text.trim()) {
      showError('Note text cannot be empty');
      return;
    }

    setIsSaving(true);
    try {
      if (noteId) {
        // Update existing note
        await updateAdminNote(noteId, text.trim());
        showSuccess('Note updated successfully');
      } else {
        // Create new note
        await createAdminNote(coordinate, text.trim());
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
    // Ctrl+Enter or Cmd+Enter to save
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
    // Escape to close
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="w-64 bg-white">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-800">
          {noteId ? 'Edit Note' : 'New Note'}
        </h3>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 text-lg leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>

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
          disabled={isSaving || !text.trim()}
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
