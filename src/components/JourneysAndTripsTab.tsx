'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/lib/toast';
import {
  getJourneysAndTrips,
  getAllTrips,
  createTrip,
} from '@/lib/tripActions';
import type { TripsAndJourneysItem, TripWithStats } from '@/lib/tripActions';
import type { SelectedRoute } from '@/lib/types';
import MergedTripCard from './MergedTripCard';
import MergedJourneyCard from './MergedJourneyCard';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

interface JourneysAndTripsTabProps {
  onHighlightRoutes?: (routeIds: number[]) => void;
  onJourneyChanged?: () => void;
  onJourneyEditStart?: (handler: (route: SelectedRoute) => void) => void;
  onJourneyEditEnd?: () => void;
}

type OpenItem = { type: 'trip' | 'journey'; id: number } | null;

export default function JourneysAndTripsTab({
  onHighlightRoutes,
  onJourneyChanged,
  onJourneyEditStart,
  onJourneyEditEnd,
}: JourneysAndTripsTabProps) {
  const { showSuccess, showError } = useToast();

  const [items, setItems] = useState<TripsAndJourneysItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const [availableTrips, setAvailableTrips] = useState<TripWithStats[]>([]);

  // Single-open coordination across all top-level cards
  const [openItem, setOpenItem] = useState<OpenItem>(null);
  // For nested journey edit inside an open trip
  const [openNestedJourneyId, setOpenNestedJourneyId] = useState<number | null>(null);

  const [isCreatingTrip, setIsCreatingTrip] = useState(false);
  const [newTripName, setNewTripName] = useState('');
  const [newTripDescription, setNewTripDescription] = useState('');
  const [isSavingNewTrip, setIsSavingNewTrip] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadItems = useCallback(async (showSpinner = false) => {
    if (showSpinner) setIsLoading(true);
    try {
      const result = await getJourneysAndTrips(page, PAGE_SIZE, debouncedSearch);
      if (result.error) {
        showError(result.error);
        setItems([]);
        setTotal(0);
      } else {
        setItems(result.items);
        setTotal(result.total);
      }
    } catch (error) {
      console.error('Error loading items:', error);
      showError('Failed to load journeys and trips');
      setItems([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [page, debouncedSearch, showError]);

  const loadAvailableTrips = useCallback(async () => {
    const result = await getAllTrips();
    if (!result.error) {
      setAvailableTrips(result.trips || []);
    }
  }, []);

  // Initial + when page/search changes
  useEffect(() => {
    loadItems(true);
  }, [loadItems]);

  // Trip dropdown options for journey edit forms
  useEffect(() => {
    loadAvailableTrips();
  }, [loadAvailableTrips]);

  // Debounce search input → reset to page 1
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Cleanup on unmount: clear highlights and any in-flight edit session
  useEffect(() => {
    return () => {
      onHighlightRoutes?.([]);
      onJourneyEditEnd?.();
    };
  }, [onHighlightRoutes, onJourneyEditEnd]);

  const handleChanged = useCallback(() => {
    loadItems();
    loadAvailableTrips();
    onJourneyChanged?.();
  }, [loadItems, loadAvailableTrips, onJourneyChanged]);

  // When the open item closes (or changes), clear highlights
  const handleRequestOpen = (next: OpenItem) => {
    setOpenItem(next);
    setOpenNestedJourneyId(null);
    if (next === null) {
      onHighlightRoutes?.([]);
    }
  };

  const handleCreateTrip = async () => {
    if (!newTripName.trim()) {
      showError('Trip name is required');
      return;
    }
    setIsSavingNewTrip(true);
    try {
      const result = await createTrip(newTripName.trim(), newTripDescription.trim() || null);
      if (result.error) {
        showError(result.error);
      } else {
        showSuccess(`Trip "${result.trip?.name}" created`);
        setNewTripName('');
        setNewTripDescription('');
        setIsCreatingTrip(false);
        handleChanged();
      }
    } catch (error) {
      console.error('Error creating trip:', error);
      showError('Failed to create trip');
    } finally {
      setIsSavingNewTrip(false);
    }
  };

  return (
    <div className="p-4 text-black space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">My Trips</h3>
          <p className="text-sm text-gray-600">Trips and journeys, sorted by date</p>
        </div>
        {!isCreatingTrip && (
          <button
            onClick={() => setIsCreatingTrip(true)}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700"
          >
            New Trip
          </button>
        )}
      </div>

      {isCreatingTrip && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded space-y-2">
          <h4 className="text-sm font-semibold">Create New Trip</h4>
          <div>
            <label className="block text-xs font-medium mb-1">Trip Name*</label>
            <input
              type="text"
              value={newTripName}
              onChange={(e) => setNewTripName(e.target.value)}
              placeholder="e.g., Summer Holiday in Austria"
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isSavingNewTrip}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Description</label>
            <textarea
              value={newTripDescription}
              onChange={(e) => setNewTripDescription(e.target.value)}
              rows={2}
              placeholder="Optional description..."
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              disabled={isSavingNewTrip}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateTrip}
              disabled={isSavingNewTrip || !newTripName.trim()}
              className={`flex-1 px-3 py-1.5 rounded text-sm font-medium ${
                isSavingNewTrip || !newTripName.trim()
                  ? 'bg-gray-400 text-white cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {isSavingNewTrip ? 'Creating...' : 'Create Trip'}
            </button>
            <button
              onClick={() => { setIsCreatingTrip(false); setNewTripName(''); setNewTripDescription(''); }}
              disabled={isSavingNewTrip}
              className="flex-1 px-3 py-1.5 bg-gray-300 text-gray-700 rounded text-sm font-medium hover:bg-gray-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div>
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name, date, or description..."
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <div className="text-center py-8 text-gray-500">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {debouncedSearch
              ? 'No trips or journeys match your search'
              : 'No trips or journeys yet. Create your first journey in the Route Logger tab!'}
          </div>
        ) : (
          items.map((item) => {
            if (item.type === 'trip') {
              const isOpen = openItem?.type === 'trip' && openItem.id === item.trip.id;
              return (
                <MergedTripCard
                  key={`trip-${item.trip.id}`}
                  trip={item.trip}
                  initialJourneys={item.journeys}
                  availableTrips={availableTrips}
                  isOpen={isOpen}
                  onRequestOpen={() => handleRequestOpen({ type: 'trip', id: item.trip.id })}
                  onRequestClose={() => handleRequestOpen(null)}
                  onChanged={handleChanged}
                  onHighlightRoutes={onHighlightRoutes}
                  openNestedJourneyId={isOpen ? openNestedJourneyId : null}
                  onNestedJourneyOpenChange={setOpenNestedJourneyId}
                  onJourneyEditStart={onJourneyEditStart}
                  onJourneyEditEnd={onJourneyEditEnd}
                />
              );
            }

            const isOpen = openItem?.type === 'journey' && openItem.id === item.journey.id;
            return (
              <MergedJourneyCard
                key={`journey-${item.journey.id}`}
                journey={item.journey}
                availableTrips={availableTrips}
                isOpen={isOpen}
                onRequestOpen={() => handleRequestOpen({ type: 'journey', id: item.journey.id })}
                onRequestClose={() => handleRequestOpen(null)}
                onChanged={handleChanged}
                onHighlightRoutes={onHighlightRoutes}
                onJourneyEditStart={onJourneyEditStart}
                onJourneyEditEnd={onJourneyEditEnd}
              />
            );
          })
        )}
      </div>

      {!isLoading && total > 0 && (
        <div className="flex items-center justify-between gap-2 pt-2 border-t">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <div className="text-xs text-gray-600">
            Page {page} of {totalPages} · {total} item{total === 1 ? '' : 's'}
          </div>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
