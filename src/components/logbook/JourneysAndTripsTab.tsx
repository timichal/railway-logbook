"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import JourneyCard from "@/components/logbook/JourneyCard";
import TripCard from "@/components/logbook/TripCard";
import { actionErrorMessage, unwrap } from "@/lib/actionResult";
import { databaseJourneyStore } from "@/lib/journeyStore";
import { useRegionId } from "@/lib/regionContext";
import type { HighlightRoutesFn, JourneyEditStartFn } from "@/lib/shared/types";
import { useToast } from "@/lib/toast";
import type { TripsAndJourneysItem, TripWithStats } from "@/lib/tripActions";
import { createTrip, getAllTrips, getJourneysAndTrips } from "@/lib/tripActions";
import { btn } from "@/lib/ui/buttonStyles";
import {
  journeyEditKey,
  NEW_TRIP_EDIT_KEY,
  tripEditKey,
  useConfirmDiscard,
  useHasChanges,
  useReportEditing,
} from "@/lib/ui/editGuard";

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

interface JourneysAndTripsTabProps {
  onHighlightRoutes?: HighlightRoutesFn;
  onJourneyChanged?: () => void;
  onJourneyEditStart?: JourneyEditStartFn;
  onJourneyEditEnd?: () => void;
}

type OpenItem = { type: "trip" | "journey"; id: number } | null;

function isItem(item: TripsAndJourneysItem, open: NonNullable<OpenItem>): boolean {
  return item.type === "trip"
    ? open.type === "trip" && item.trip.id === open.id
    : open.type === "journey" && item.journey.id === open.id;
}

/**
 * A reloaded page, with the card that has unsaved changes kept where it was if
 * the reload left it out — a nested journey's new date can move its trip to
 * another page, and dropping the card would drop the trip's half-edited form.
 */
function keepListed(
  next: TripsAndJourneysItem[],
  prev: TripsAndJourneysItem[],
  keep: OpenItem,
): TripsAndJourneysItem[] {
  if (!keep || next.some((item) => isItem(item, keep))) return next;
  const index = prev.findIndex((item) => isItem(item, keep));
  if (index === -1) return next;
  return [...next.slice(0, index), prev[index], ...next.slice(index)];
}

export default function JourneysAndTripsTab({
  onHighlightRoutes,
  onJourneyChanged,
  onJourneyEditStart,
  onJourneyEditEnd,
}: JourneysAndTripsTabProps) {
  const regionId = useRegionId();
  const { showSuccess, showError } = useToast();

  const [items, setItems] = useState<TripsAndJourneysItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const [availableTrips, setAvailableTrips] = useState<TripWithStats[]>([]);

  // Single-open coordination across all top-level cards
  const [openItem, setOpenItem] = useState<OpenItem>(null);
  // For nested journey edit inside an open trip
  const [openNestedJourneyId, setOpenNestedJourneyId] = useState<number | null>(null);

  const [isCreatingTrip, setIsCreatingTrip] = useState(false);
  const [newTripName, setNewTripName] = useState("");
  const [newTripDescription, setNewTripDescription] = useState("");
  const [isSavingNewTrip, setIsSavingNewTrip] = useState(false);

  // A region switch collapses the open card, as in LocalJourneyLogTab, and the
  // new trip form: a card listed in both regions (a journey with no routes yet)
  // would otherwise stay open, and both would keep the changes the user agreed to
  // discard when switching. The highlight is dropped by the map anyway.
  const [listedRegionId, setListedRegionId] = useState(regionId);
  if (listedRegionId !== regionId) {
    setListedRegionId(regionId);
    setOpenItem(null);
    setOpenNestedJourneyId(null);
    setIsCreatingTrip(false);
    setNewTripName("");
    setNewTripDescription("");
  }

  useReportEditing(
    NEW_TRIP_EDIT_KEY,
    "the new trip",
    isCreatingTrip && (newTripName.trim() !== "" || newTripDescription.trim() !== ""),
  );

  // The forms that closing the open card would drop: its own, and its open nested
  // journey's. While either has changes, search and paging (which can take the
  // card out of the list) are disabled, opening another card asks first, and a
  // reload keeps the card listed.
  const openEditKeys =
    openItem === null
      ? []
      : openItem.type === "journey"
        ? [journeyEditKey(openItem.id)]
        : openNestedJourneyId === null
          ? [tripEditKey(openItem.id)]
          : [tripEditKey(openItem.id), journeyEditKey(openNestedJourneyId)];
  const hasChanges = useHasChanges(openEditKeys);
  const confirmDiscard = useConfirmDiscard();
  // Read by loadItems, which would otherwise be rebuilt (and reload) on every change
  const keepListedRef = useRef<OpenItem>(null);
  keepListedRef.current = hasChanges ? openItem : null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Only the latest request may write: a slow filtered query otherwise lands
  // after the search was cleared, and fast Prev/Next shows whichever page
  // answered last.
  const loadRequestRef = useRef(0);

  const loadItems = useCallback(
    async (showSpinner = false) => {
      const requestId = ++loadRequestRef.current;
      let steppedBack = false;
      if (showSpinner) setIsLoading(true);
      try {
        const result = unwrap(
          await getJourneysAndTrips(page, PAGE_SIZE, debouncedSearch, regionId),
        );
        if (requestId !== loadRequestRef.current) return;
        // Deleting the last item on the last page leaves `page` past the end;
        // step back rather than show "Page 3 of 2" over an empty list. The
        // stale page (the deleted item included) goes at once, and the spinner
        // stays up until the earlier page arrives.
        const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
        if (page > lastPage) {
          steppedBack = true;
          setItems([]);
          setIsLoading(true);
          setPage(lastPage);
          return;
        }
        const keep = keepListedRef.current;
        setItems((prev) => keepListed(result.items, prev, keep));
        setTotal(result.total);
      } catch (error) {
        if (requestId !== loadRequestRef.current) return;
        console.error("Error loading items:", error);
        showError(actionErrorMessage(error, "Failed to load journeys and trips"));
        const keep = keepListedRef.current;
        setItems((prev) => keepListed([], prev, keep));
        setTotal(0);
      } finally {
        if (requestId === loadRequestRef.current && !steppedBack) setIsLoading(false);
      }
    },
    [page, debouncedSearch, regionId, showError],
  );

  const loadAvailableTrips = useCallback(async () => {
    // A failure leaves the picker as it was, which only costs filing a journey
    // under a trip later.
    try {
      setAvailableTrips(unwrap(await getAllTrips(regionId)));
    } catch (error) {
      console.error("Error loading trips:", error);
    }
  }, [regionId]);

  // Initial + when page/search changes
  useEffect(() => {
    loadItems(true);
  }, [loadItems]);

  // Trip dropdown options for journey edit forms
  useEffect(() => {
    loadAvailableTrips();
  }, [loadAvailableTrips]);

  // A page or search change, or a reload after a delete, can take the open card
  // out of the list — never one with unsaved changes (see `keepListed`). The card
  // ends its own map edit session as it unmounts; what is left here is the open
  // state and its highlights, which would otherwise linger for an item no longer
  // shown. Only then: a card still in the new results stays open.
  useEffect(() => {
    if (!openItem) return;
    if (items.some((item) => isItem(item, openItem))) return;
    setOpenItem(null);
    setOpenNestedJourneyId(null);
    onHighlightRoutes?.([]);
  }, [items, openItem, onHighlightRoutes]);

  // Debounce search input → reset to page 1. Held while the open card has changes:
  // the field is disabled then, but a search typed just before is still on its way.
  useEffect(() => {
    const next = searchInput.trim();
    if (next === debouncedSearch || hasChanges) return;
    const t = setTimeout(() => {
      setDebouncedSearch(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput, debouncedSearch, hasChanges]);

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

  // When the open item closes (or changes), clear highlights. Not guarded: a card
  // closes itself only once it is done (deleted, or moved to another trip), and a
  // header tap that closes one is locked while it is edited (a trip's guards the
  // nested journey it would close itself).
  const handleRequestOpen = (next: OpenItem) => {
    setOpenItem(next);
    setOpenNestedJourneyId(null);
    if (next === null) {
      onHighlightRoutes?.([]);
    }
  };

  const handleCreateTrip = async () => {
    if (!newTripName.trim()) {
      showError("Trip name is required");
      return;
    }
    setIsSavingNewTrip(true);
    try {
      const trip = unwrap(await createTrip(newTripName.trim(), newTripDescription.trim() || null));
      showSuccess(`Trip "${trip.name}" created`);
      setNewTripName("");
      setNewTripDescription("");
      setIsCreatingTrip(false);
      handleChanged();
    } catch (error) {
      console.error("Error creating trip:", error);
      showError(actionErrorMessage(error, "Failed to create trip"));
    } finally {
      setIsSavingNewTrip(false);
    }
  };

  // Opening another card closes the open one, nested journey and all
  const handleRequestOpenGuarded = (next: OpenItem) =>
    confirmDiscard(() => handleRequestOpen(next), openEditKeys);

  return (
    <div className="p-4 text-fg space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">My Trips</h3>
          <p className="text-sm text-gray-600">Trips and journeys, sorted by date</p>
        </div>
        {!isCreatingTrip && (
          <button type="button" onClick={() => setIsCreatingTrip(true)} className={btn("primary")}>
            New Trip
          </button>
        )}
      </div>

      {isCreatingTrip && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded space-y-2">
          <h4 className="text-sm font-semibold">Create New Trip</h4>
          <div>
            <label htmlFor="new-trip-name" className="block text-xs font-medium mb-1">
              Trip Name*
            </label>
            <input
              id="new-trip-name"
              type="text"
              value={newTripName}
              onChange={(e) => setNewTripName(e.target.value)}
              placeholder="e.g., Summer Holiday in Austria"
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isSavingNewTrip}
            />
          </div>
          <div>
            <label htmlFor="new-trip-description" className="block text-xs font-medium mb-1">
              Description
            </label>
            <textarea
              id="new-trip-description"
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
              type="button"
              onClick={handleCreateTrip}
              disabled={isSavingNewTrip || !newTripName.trim()}
              className={`${btn("success")} flex-1`}
            >
              {isSavingNewTrip ? "Creating..." : "Create Trip"}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreatingTrip(false);
                setNewTripName("");
                setNewTripDescription("");
              }}
              disabled={isSavingNewTrip}
              className={`${btn("subtle")} flex-1`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div>
        <input
          type="text"
          aria-label="Search trips and journeys"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name, date, or description..."
          disabled={hasChanges}
          title={hasChanges ? "Save or cancel the edit to search" : undefined}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
        />
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <div className="text-center py-8 text-gray-500">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {debouncedSearch
              ? "No trips or journeys match your search"
              : "No trips or journeys yet. Create your first journey in the Route Logger tab!"}
          </div>
        ) : (
          items.map((item) => {
            if (item.type === "trip") {
              const isOpen = openItem?.type === "trip" && openItem.id === item.trip.id;
              return (
                <TripCard
                  key={`trip-${item.trip.id}`}
                  trip={item.trip}
                  initialJourneys={item.journeys}
                  availableTrips={availableTrips}
                  isOpen={isOpen}
                  onRequestOpen={() => handleRequestOpenGuarded({ type: "trip", id: item.trip.id })}
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

            const isOpen = openItem?.type === "journey" && openItem.id === item.journey.id;
            return (
              <JourneyCard
                key={`journey-${item.journey.id}`}
                journey={item.journey}
                store={databaseJourneyStore}
                availableTrips={availableTrips}
                isOpen={isOpen}
                onRequestOpen={() =>
                  handleRequestOpenGuarded({ type: "journey", id: item.journey.id })
                }
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
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || hasChanges}
            className={btn("subtle", "xs")}
          >
            ← Prev
          </button>
          <div className="text-xs text-gray-600">
            Page {page} of {totalPages} · {total} item{total === 1 ? "" : "s"}
          </div>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || hasChanges}
            className={btn("subtle", "xs")}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
