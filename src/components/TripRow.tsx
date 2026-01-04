'use client';

import { useState, useEffect } from 'react';
import type { UserTrip } from '@/lib/types';

interface TripRowProps {
  trip: UserTrip | null; // null for new trip row
  onUpdate: (tripId: number | string, date: string, note: string | null, partial: boolean) => Promise<void>;
  onDelete: (tripId: number | string) => Promise<void>;
  onAdd: (date: string, note: string | null, partial: boolean) => Promise<void>;
  isNewRow?: boolean;
}

export default function TripRow({ trip, onUpdate, onDelete, onAdd, isNewRow = false }: TripRowProps) {
  const [date, setDate] = useState(trip?.date || '');
  const [note, setNote] = useState(trip?.note || '');
  const [partial, setPartial] = useState(trip?.partial || false);

  // Update local state when trip prop changes
  useEffect(() => {
    if (trip) {
      setDate(trip.date);
      setNote(trip.note || '');
      setPartial(trip.partial);
    }
  }, [trip]);

  const handleDateBlur = async () => {
    if (isNewRow) return; // Don't save on blur for new rows

    if (!date) return;

    if (trip && date !== trip.date) {
      await onUpdate(trip.id, date, note || null, partial);
    }
  };

  const handleNoteBlur = async () => {
    if (isNewRow) return; // Only save on date blur for new rows

    if (trip && note !== (trip.note || '')) {
      await onUpdate(trip.id, trip.date, note || null, partial);
    }
  };

  const handlePartialChange = async (checked: boolean) => {
    setPartial(checked);

    if (isNewRow) return; // Don't save yet for new rows

    if (trip) {
      await onUpdate(trip.id, trip.date, note || null, checked);
    }
  };

  return (
    <tr className="border-b hover:bg-gray-50">
      <td className="p-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          onBlur={handleDateBlur}
          className="w-full px-2 py-1 border rounded text-sm"
        />
      </td>
      <td className="p-2">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={handleNoteBlur}
          className="w-full px-2 py-1 border rounded text-sm"
          placeholder="Note..."
        />
      </td>
      <td className="p-2 text-center">
        <input
          type="checkbox"
          checked={partial}
          onChange={(e) => handlePartialChange(e.target.checked)}
          className="w-4 h-4 cursor-pointer"
        />
      </td>
      <td className="p-2 text-center">
        {!isNewRow && trip && (
          <button
            onClick={() => onDelete(trip.id)}
            className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
          >
            Delete
          </button>
        )}
        {isNewRow && date && (
          <button
            onClick={async () => {
              await onAdd(date, note || null, partial);
              // Clear form after adding
              setDate('');
              setNote('');
              setPartial(false);
            }}
            className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
          >
            Add
          </button>
        )}
      </td>
    </tr>
  );
}
