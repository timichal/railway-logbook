'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/lib/toast';
import { LocalStorageManager } from '@/lib/localStorage';
import type { LocalJourney, LocalLoggedPart } from '@/lib/types';
import { getUntimezonedDateStr } from '@/lib/getUntimezonedDateStr';

interface JourneyWithRoutes {
  journey: LocalJourney;
  parts: LocalLoggedPart[];
}

interface LocalJourneyLogTabProps {
  onHighlightRoutes?: (routeIds: number[]) => void;
  onJourneyChanged?: () => void;
}

export default function LocalJourneyLogTab({
  onHighlightRoutes,
  onJourneyChanged
}: LocalJourneyLogTabProps) {
  const { showSuccess, showError } = useToast();
  const [journeys, setJourneys] = useState<JourneyWithRoutes[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [viewedJourneyId, setViewedJourneyId] = useState<string | null>(null);

  // Edit state
  const [editingJourneyId, setEditingJourneyId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // Load journeys on mount and when storage changes
  useEffect(() => {
    loadJourneys();

    // Listen for storage changes from other tabs
    const cleanup = LocalStorageManager.onStorageChange(() => {
      loadJourneys();
    });

    return cleanup;
  }, []);

  // Clear highlights when component unmounts (tab switched)
  useEffect(() => {
    return () => {
      if (onHighlightRoutes) {
        onHighlightRoutes([]);
      }
    };
  }, [onHighlightRoutes]);

  const loadJourneys = () => {
    const allJourneys = LocalStorageManager.getJourneys();
    const allParts = LocalStorageManager.getLoggedParts();

    const journeysWithRoutes: JourneyWithRoutes[] = allJourneys.map(journey => ({
      journey,
      parts: allParts.filter(part => part.journey_id === journey.id),
    }));

    // Sort by date descending
    journeysWithRoutes.sort((a, b) =>
      new Date(b.journey.date).getTime() - new Date(a.journey.date).getTime()
    );

    setJourneys(journeysWithRoutes);
  };

  const handleViewJourney = (journeyId: string) => {
    // Toggle view - if already viewing this journey, collapse it
    if (viewedJourneyId === journeyId) {
      setViewedJourneyId(null);
      setEditingJourneyId(null);
      if (onHighlightRoutes) {
        onHighlightRoutes([]);
      }
      return;
    }

    const journeyData = journeys.find(j => j.journey.id === journeyId);
    if (!journeyData) return;

    setViewedJourneyId(journeyId);

    // Set up edit mode with current journey data
    setEditingJourneyId(journeyId);
    setEditName(journeyData.journey.name);
    const dateStr = getUntimezonedDateStr(journeyData.journey.date);
    setEditDate(dateStr);
    setEditDescription(journeyData.journey.description || '');

    // Highlight routes on map
    if (onHighlightRoutes) {
      const routeIds = journeyData.parts.map(p => p.track_id);
      onHighlightRoutes(routeIds);
    }
  };

  const handleSaveEdit = () => {
    if (!editingJourneyId) return;

    if (!editName.trim() || !editDate) {
      showError('Journey name and date are required');
      return;
    }

    try {
      LocalStorageManager.updateJourney(editingJourneyId, {
        name: editName.trim(),
        description: editDescription.trim() || null,
        date: editDate,
      });

      showSuccess('Journey updated successfully');
      loadJourneys();

      // Trigger map refresh
      if (onJourneyChanged) {
        onJourneyChanged();
      }
    } catch (error) {
      console.error('Error updating journey:', error);
      showError('Failed to update journey');
    }
  };

  const handleCancelEdit = () => {
    // Restore original values from the journey
    const journeyData = journeys.find(j => j.journey.id === editingJourneyId);
    if (journeyData) {
      setEditName(journeyData.journey.name);
      const dateStr = getUntimezonedDateStr(journeyData.journey.date);
      setEditDate(dateStr);
      setEditDescription(journeyData.journey.description || '');
    }
  };

  const handleDelete = (journeyId: string) => {
    try {
      LocalStorageManager.deleteJourney(journeyId);
      showSuccess('Journey deleted successfully');

      // If we were viewing this journey, clear the view
      if (viewedJourneyId === journeyId) {
        setViewedJourneyId(null);
        if (onHighlightRoutes) {
          onHighlightRoutes([]);
        }
      }

      loadJourneys();

      // Trigger map refresh to update route colors
      if (onJourneyChanged) {
        onJourneyChanged();
      }
    } catch (error) {
      console.error('Error deleting journey:', error);
      showError('Failed to delete journey');
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleDeletePart = (partId: string) => {
    try {
      LocalStorageManager.deleteLoggedPart(partId);
      showSuccess('Route removed from journey');
      loadJourneys();

      // Trigger map refresh
      if (onJourneyChanged) {
        onJourneyChanged();
      }
    } catch (error) {
      console.error('Error deleting logged part:', error);
      showError('Failed to remove route');
    }
  };

  const handleTogglePartial = (partId: string, currentPartial: boolean) => {
    try {
      LocalStorageManager.updateLoggedPart(partId, !currentPartial);
      loadJourneys();

      // Trigger map refresh
      if (onJourneyChanged) {
        onJourneyChanged();
      }
    } catch (error) {
      console.error('Error updating partial flag:', error);
      showError('Failed to update partial flag');
    }
  };

  // Filter journeys by search query
  const filteredJourneys = journeys.filter(({ journey }) => {
    const query = searchQuery.toLowerCase();
    const matchesName = journey.name.toLowerCase().includes(query);
    const matchesDate = String(journey.date).includes(query);
    const matchesDescription = journey.description?.toLowerCase().includes(query) || false;
    return matchesName || matchesDate || matchesDescription;
  });

  return (
    <div className="p-4 text-black space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-bold mb-2">My Journeys (Local Storage)</h3>
        <p className="text-sm text-gray-600">
          View and manage your railway journeys ({journeys.length}/5 used)
        </p>
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name, date, or description..."
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Journey List */}
      <div className="space-y-2">
        {filteredJourneys.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {searchQuery
              ? 'No journeys match your search'
              : 'No journeys yet. Create your first journey in the Route Logger tab!'
            }
          </div>
        ) : (
          filteredJourneys.map(({ journey, parts }) => (
            <div
              key={journey.id}
              className="p-3 bg-white border border-gray-300 rounded shadow-sm"
            >
              {/* Journey Header */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-base truncate">{journey.name}</h4>
                  {journey.description && (
                    <div className="text-xs text-gray-600 mt-1">
                      {journey.description}
                    </div>
                  )}
                </div>
              </div>

              {/* Journey Stats */}
              <div className="flex items-center gap-4 text-xs text-gray-700 mb-3">
                <span className="font-medium">
                  {new Date(journey.date).toLocaleDateString('cs-CZ')}
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-medium">{parts.length}</span>
                  <span>routes</span>
                </span>
              </div>

              {/* Action Buttons */}
              {deleteConfirmId === journey.id ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDelete(journey.id)}
                    className="flex-1 px-3 py-1.5 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700"
                  >
                    Confirm Delete
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="flex-1 px-3 py-1.5 bg-gray-300 text-gray-700 rounded text-sm font-medium hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleViewJourney(journey.id)}
                    className={`flex-1 px-3 py-1.5 rounded text-sm font-medium ${viewedJourneyId === journey.id
                      ? 'bg-amber-600 text-white hover:bg-amber-700'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                  >
                    {viewedJourneyId === journey.id ? 'Hide Details' : 'View / Edit'}
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(journey.id)}
                    className="px-3 py-1.5 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700"
                  >
                    Delete
                  </button>
                </div>
              )}

              {/* Edit Form and Journey Details - shown when viewing */}
              {viewedJourneyId === journey.id && (
                <div className="mt-3 pt-3 border-t border-gray-200 space-y-3">
                  {/* Edit Form */}
                  {editingJourneyId === journey.id && (
                    <div className="space-y-2">
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">
                        Edit Journey
                      </h5>
                      <div>
                        <label className="block text-xs font-medium mb-1">Journey Name*</label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Date*</label>
                        <input
                          type="date"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Description</label>
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={2}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleSaveEdit}
                          disabled={!editName.trim() || !editDate}
                          className={`flex-1 px-3 py-1.5 rounded text-xs font-medium ${!editName.trim() || !editDate
                            ? 'bg-gray-400 text-white cursor-not-allowed'
                            : 'bg-green-600 text-white hover:bg-green-700'
                            }`}
                        >
                          Save Changes
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="flex-1 px-3 py-1.5 bg-gray-300 text-gray-700 rounded text-xs font-medium hover:bg-gray-400"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Routes List */}
                  {parts.length > 0 && (
                    <div>
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">
                        Routes in this journey:
                      </h5>
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {parts.map((part) => (
                          <div
                            key={part.id}
                            className="p-2 bg-gray-50 border border-gray-200 rounded text-xs flex items-start justify-between gap-2"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-medium">
                                Route #{part.track_id}
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-gray-600">
                                {part.partial && (
                                  <span className="text-orange-600 font-medium">Partial</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Status Info */}
      {filteredJourneys.length > 0 && (
        <div className="text-xs text-gray-600 text-center pt-2 border-t">
          Showing {filteredJourneys.length} of {journeys.length} journeys
        </div>
      )}
    </div>
  );
}
