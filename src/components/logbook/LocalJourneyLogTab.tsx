"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import JourneyCard from "@/components/logbook/JourneyCard";
import { useAsyncLoad } from "@/hooks/useAsyncLoad";
import { localJourneyStore } from "@/lib/journeyStore";
import * as localStore from "@/lib/localStorage";
import { useRegionId } from "@/lib/regionContext";
import { formatDateOnly } from "@/lib/shared/getUntimezonedDateStr";
import type {
  HighlightRoutesFn,
  JourneyEditStartFn,
  LocalJourney,
  LocalLoggedPart,
} from "@/lib/shared/types";
import { journeyEditKey, useConfirmDiscard, useHasChanges } from "@/lib/ui/editGuard";
import { getRegionTrackIds } from "@/lib/userActions";

interface JourneyWithRoutes {
  journey: LocalJourney;
  parts: LocalLoggedPart[];
}

interface LocalJourneyLogTabProps {
  onHighlightRoutes?: HighlightRoutesFn;
  onJourneyChanged?: () => void;
  onJourneyEditStart?: JourneyEditStartFn;
  onJourneyEditEnd?: () => void;
}

/** My Journeys for an anonymous visitor: the journeys saved in this browser, as `JourneyCard`s. */
export default function LocalJourneyLogTab({
  onHighlightRoutes,
  onJourneyChanged,
  onJourneyEditStart,
  onJourneyEditEnd,
}: LocalJourneyLogTabProps) {
  const regionId = useRegionId();
  const [journeys, setJourneys] = useState<JourneyWithRoutes[]>([]);
  // Track ids of the region on screen, refetched when the region changes. A
  // localStorage journey knows only track ids, so this is what tells the list
  // which journeys belong here; null while it loads (or if it failed), and then
  // everything is shown rather than nothing.
  const { data: regionTrackIds } = useAsyncLoad(
    () => getRegionTrackIds(regionId).then((ids) => new Set(ids)),
    [regionId],
    "region route ids",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [openJourneyId, setOpenJourneyId] = useState<string | null>(null);
  // As in JourneysAndTripsTab: while the open journey has unsaved changes the
  // search (which can filter it out) is disabled, and opening another asks first.
  const openEditKeys = openJourneyId === null ? [] : [journeyEditKey(openJourneyId)];
  const hasChanges = useHasChanges(openEditKeys);
  const confirmDiscard = useConfirmDiscard();

  // Any journey open when the region changes is collapsed: it may not be in this
  // region at all, and its highlight is dropped by the map anyway. Done during
  // the render that sees the new region, so it is never drawn open under it.
  const [listedRegionId, setListedRegionId] = useState(regionId);
  if (listedRegionId !== regionId) {
    setListedRegionId(regionId);
    setOpenJourneyId(null);
  }

  const loadJourneys = useCallback(() => {
    const parts = localStore.getLoggedParts();
    setJourneys(
      localStore
        .getJourneys()
        .map((journey) => ({
          journey,
          parts: parts.filter((part) => part.journey_id === journey.id),
        }))
        .sort((a, b) => b.journey.date.localeCompare(a.journey.date)),
    );
  }, []);

  // On mount, and whenever another tab changes the stored journeys
  useEffect(() => {
    loadJourneys();
    return localStore.onStorageChange(loadJourneys);
  }, [loadJourneys]);

  // The tab switched away: its highlights go with it
  useEffect(() => () => onHighlightRoutes?.([]), [onHighlightRoutes]);

  const handleClose = () => {
    setOpenJourneyId(null);
    onHighlightRoutes?.([]);
  };

  const handleChanged = () => {
    loadJourneys();
    onJourneyChanged?.();
  };

  // Journeys of the region on screen. One with no routes logged yet belongs to
  // every region, mirroring how the database journey list treats an empty one.
  const regionJourneys = useMemo(() => {
    if (!regionTrackIds) return journeys;
    return journeys.filter(
      ({ parts }) => parts.length === 0 || parts.some((part) => regionTrackIds.has(part.track_id)),
    );
  }, [journeys, regionTrackIds]);

  const filteredJourneys = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return regionJourneys.filter(
      ({ journey }) =>
        journey.name.toLowerCase().includes(query) ||
        // The stored day, and the day as the card shows it in the viewer's locale
        journey.date.includes(query) ||
        formatDateOnly(journey.date).includes(query) ||
        journey.description?.toLowerCase().includes(query),
    );
  }, [regionJourneys, searchQuery]);

  // A search (or another tab's delete) can take the open card out of the list. The
  // card ends its own map edit session as it unmounts; its open state and
  // highlights are left here, as in JourneysAndTripsTab.
  useEffect(() => {
    if (openJourneyId && !filteredJourneys.some(({ journey }) => journey.id === openJourneyId)) {
      setOpenJourneyId(null);
      onHighlightRoutes?.([]);
    }
  }, [filteredJourneys, openJourneyId, onHighlightRoutes]);

  return (
    <div className="p-4 text-fg space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-bold mb-2">My Journeys (Local Storage)</h3>
        <p className="text-sm text-gray-600">
          View and manage your railway journeys ({journeys.length}/{localStore.MAX_JOURNEYS} used)
        </p>
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          aria-label="Search journeys"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name, date, or description..."
          disabled={hasChanges}
          title={hasChanges ? "Save or cancel the edit to search" : undefined}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
        />
      </div>

      {/* Journey List */}
      <div className="space-y-2">
        {filteredJourneys.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {searchQuery
              ? "No journeys match your search"
              : "No journeys yet. Create your first journey in the Route Logger tab!"}
          </div>
        ) : (
          filteredJourneys.map(({ journey, parts }) => (
            <JourneyCard
              key={journey.id}
              journey={{ ...journey, route_count: parts.length }}
              store={localJourneyStore}
              isOpen={openJourneyId === journey.id}
              onRequestOpen={() => confirmDiscard(() => setOpenJourneyId(journey.id), openEditKeys)}
              onRequestClose={handleClose}
              onChanged={handleChanged}
              onHighlightRoutes={onHighlightRoutes}
              onJourneyEditStart={onJourneyEditStart}
              onJourneyEditEnd={onJourneyEditEnd}
            />
          ))
        )}
      </div>

      {/* Status Info */}
      {filteredJourneys.length > 0 && (
        <div className="text-xs text-gray-600 text-center pt-2 border-t">
          Showing {filteredJourneys.length} of {regionJourneys.length} journeys
        </div>
      )}
    </div>
  );
}
