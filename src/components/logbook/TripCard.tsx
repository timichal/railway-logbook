"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CardHeader from "@/components/logbook/CardHeader";
import JourneyCard from "@/components/logbook/JourneyCard";
import { actionErrorMessage, unwrap } from "@/lib/actionResult";
import { plural } from "@/lib/plural";
import { useRegionId } from "@/lib/regionContext";
import { formatDateOnly, formatDateOnlyRange } from "@/lib/shared/getUntimezonedDateStr";
import type { HighlightRoutesFn, JourneyEditStartFn } from "@/lib/shared/types";
import { useToast } from "@/lib/toast";
import type { JourneyInTrip, TripWithStats } from "@/lib/tripActions";
import {
  assignJourneyToTrip,
  deleteTrip,
  getTrip,
  getUnassignedJourneys,
  updateTrip,
} from "@/lib/tripActions";
import { btn, LINK_BTN } from "@/lib/ui/buttonStyles";
import { useFocusAfterRender } from "@/lib/ui/useFocusAfterRender";

interface TripCardProps {
  trip: TripWithStats;
  initialJourneys: JourneyInTrip[];
  availableTrips: TripWithStats[];
  // Parent enforces single-open across all top-level cards
  isOpen: boolean;
  onRequestOpen: () => void;
  onRequestClose: () => void;
  onChanged: () => void;
  onHighlightRoutes?: HighlightRoutesFn;
  // Forwarded to nested journey cards
  openNestedJourneyId: number | null;
  onNestedJourneyOpenChange: (journeyId: number | null) => void;
  onJourneyEditStart?: JourneyEditStartFn;
  onJourneyEditEnd?: () => void;
}

export default function TripCard({
  trip,
  initialJourneys,
  availableTrips,
  isOpen,
  onRequestOpen,
  onRequestClose,
  onChanged,
  onHighlightRoutes,
  openNestedJourneyId,
  onNestedJourneyOpenChange,
  onJourneyEditStart,
  onJourneyEditEnd,
}: TripCardProps) {
  const regionId = useRegionId();
  const { showSuccess, showError } = useToast();

  const [journeys, setJourneys] = useState<JourneyInTrip[]>(initialJourneys);
  const [editName, setEditName] = useState(trip.name);
  const [editDescription, setEditDescription] = useState(trip.description || "");
  // An open trip shows its journeys; the name and description form is behind Edit.
  const [isEditing, setIsEditing] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const [showPicker, setShowPicker] = useState(false);
  const [unassignedJourneys, setUnassignedJourneys] = useState<JourneyInTrip[]>([]);
  const [isLoadingUnassigned, setIsLoadingUnassigned] = useState(false);

  const focusAfterRender = useFocusAfterRender();
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const confirmCancelRef = useRef<HTMLButtonElement>(null);

  // Sync from props when they change (after parent refreshes the list)
  useEffect(() => {
    setJourneys(initialJourneys);
  }, [initialJourneys]);

  // Read again once the trip has loaded: the card may have closed, or a nested
  // journey opened, while it was on its way, and the highlight then belongs to
  // someone else. The region too, so a switch does not re-run the effects below.
  const latest = useRef({ isOpen, openNestedJourneyId, regionId });
  latest.current = { isOpen, openNestedJourneyId, regionId };

  // When a nested journey is being edited, the journey card owns highlights.
  // Otherwise, when the trip is open, highlight all routes in the trip. `fit` brings
  // them into view, which only opening the trip asks for — a nested journey closing
  // or a journey assigned re-highlights a trip already being looked at.
  const refreshTripHighlights = useCallback(
    async (fit = false) => {
      const ownsHighlight = () =>
        latest.current.isOpen && latest.current.openNestedJourneyId === null;
      if (!ownsHighlight()) return;
      try {
        const result = unwrap(await getTrip(trip.id, latest.current.regionId));
        if (!ownsHighlight()) return;
        setJourneys(result.journeys);
        onHighlightRoutes?.(result.routeIds, "view", undefined, { fit, bounds: result.bounds });
      } catch (error) {
        console.error("Error loading trip:", error);
      }
    },
    [trip.id, onHighlightRoutes],
  );

  // Whether the trip was open on the last run, so the run that opens it can tell
  // itself apart from one where a nested journey closed.
  const wasOpen = useRef(false);
  useEffect(() => {
    const justOpened = isOpen && !wasOpen.current;
    wasOpen.current = isOpen;
    if (!isOpen) return;
    if (openNestedJourneyId !== null) return;
    // (Re)highlight all trip routes whenever trip opens or nested journey closes
    void refreshTripHighlights(justOpened);
  }, [isOpen, openNestedJourneyId, refreshTripHighlights]);

  useEffect(() => {
    if (isOpen) return;
    setIsEditing(false);
    setShowPicker(false);
    setDeleteConfirm(false);
  }, [isOpen]);

  const handleSaveEdit = async () => {
    if (!editName.trim()) {
      showError("Trip name is required");
      return;
    }
    setIsSavingEdit(true);
    try {
      unwrap(await updateTrip(trip.id, editName.trim(), editDescription.trim() || null));
      showSuccess("Trip updated");
      setIsEditing(false);
      focusAfterRender(() => editButtonRef.current);
      onChanged();
    } catch (error) {
      console.error("Error updating trip:", error);
      showError(actionErrorMessage(error, "Failed to update trip"));
    } finally {
      setIsSavingEdit(false);
    }
  };

  // The form starts from the trip as it is now, whatever an abandoned edit left in it
  const handleStartEdit = () => {
    setEditName(trip.name);
    setEditDescription(trip.description || "");
    setDeleteConfirm(false);
    setIsEditing(true);
    focusAfterRender(() => document.getElementById(`trip-${trip.id}-name`));
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    focusAfterRender(() => editButtonRef.current);
  };

  const handleAskDelete = () => {
    setDeleteConfirm(true);
    focusAfterRender(() => confirmCancelRef.current);
  };

  const handleCancelDelete = () => {
    setDeleteConfirm(false);
    focusAfterRender(() => deleteButtonRef.current);
  };

  const handleDelete = async () => {
    try {
      unwrap(await deleteTrip(trip.id));
      showSuccess("Trip deleted (journeys unassigned)");
      onRequestClose();
      onChanged();
    } catch (error) {
      console.error("Error deleting trip:", error);
      showError(actionErrorMessage(error, "Failed to delete trip"));
      handleCancelDelete();
    }
  };

  const handleShowPicker = async () => {
    setShowPicker(true);
    setIsLoadingUnassigned(true);
    try {
      setUnassignedJourneys(unwrap(await getUnassignedJourneys(regionId)).journeys);
    } catch (error) {
      console.error("Error loading unassigned journeys:", error);
      showError(actionErrorMessage(error, "Failed to load unassigned journeys"));
      setUnassignedJourneys([]);
    } finally {
      setIsLoadingUnassigned(false);
    }
  };

  const handleAssignJourney = async (journeyId: number) => {
    try {
      unwrap(await assignJourneyToTrip(journeyId, trip.id));
      showSuccess("Journey added to trip");
      setUnassignedJourneys((prev) => prev.filter((j) => j.id !== journeyId));
      await refreshTripHighlights();
      onChanged();
    } catch (error) {
      console.error("Error assigning journey:", error);
      showError(actionErrorMessage(error, "Failed to assign journey"));
    }
  };

  const dateRange = trip.start_date
    ? formatDateOnlyRange(trip.start_date, trip.end_date)
    : "No journeys";

  return (
    <div className="bg-surface border border-purple-300 rounded shadow-sm">
      <CardHeader
        title={trip.name}
        badge={
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-800 flex-shrink-0 tracking-wide">
            Trip
          </span>
        }
        description={trip.description}
        meta={[
          dateRange,
          plural(trip.journey_count, "journey"),
          plural(trip.route_count, "route"),
          `${Number(trip.total_distance).toFixed(1)} km`,
        ].join(" · ")}
        isOpen={isOpen}
        onToggle={isOpen ? onRequestClose : onRequestOpen}
        locked={isEditing}
      />

      {isOpen && (
        <div className="px-3 pb-3 pt-2 border-t border-gray-200 space-y-3">
          {isEditing && (
            <div className="space-y-2">
              <h5 className="text-sm font-semibold text-gray-700 mb-2">Edit Trip</h5>
              <div>
                <label htmlFor={`trip-${trip.id}-name`} className="block text-xs font-medium mb-1">
                  Trip Name*
                </label>
                <input
                  id={`trip-${trip.id}-name`}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isSavingEdit}
                />
              </div>
              <div>
                <label
                  htmlFor={`trip-${trip.id}-description`}
                  className="block text-xs font-medium mb-1"
                >
                  Description
                </label>
                <textarea
                  id={`trip-${trip.id}-description`}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  disabled={isSavingEdit}
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={isSavingEdit || !editName.trim()}
                  className={`${btn("success", "xs")} flex-1`}
                >
                  {isSavingEdit ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  disabled={isSavingEdit}
                  className={`${btn("subtle", "xs")} flex-1`}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h5 className="text-sm font-semibold text-gray-700">Journeys ({journeys.length})</h5>
              <button type="button" onClick={handleShowPicker} className={btn("softPrimary", "xs")}>
                Add Journeys
              </button>
            </div>

            {journeys.length === 0 ? (
              <div className="text-xs text-gray-500 text-center py-4 bg-gray-50 rounded border border-gray-200">
                No journeys assigned yet
              </div>
            ) : (
              <div className="space-y-2">
                {journeys.map((journey) => (
                  <div key={journey.id} className="relative">
                    <JourneyCard
                      journey={journey}
                      availableTrips={availableTrips}
                      isOpen={openNestedJourneyId === journey.id}
                      onRequestOpen={() => onNestedJourneyOpenChange(journey.id)}
                      onRequestClose={() => onNestedJourneyOpenChange(null)}
                      onChanged={onChanged}
                      onHighlightRoutes={onHighlightRoutes}
                      onJourneyEditStart={onJourneyEditStart}
                      onJourneyEditEnd={onJourneyEditEnd}
                      nested
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {showPicker && (
            <div className="border border-blue-200 rounded bg-blue-50 p-2">
              <div className="flex items-center justify-between mb-2">
                <h5 className="text-xs font-semibold text-blue-800">Unassigned Journeys</h5>
                <button type="button" onClick={() => setShowPicker(false)} className={LINK_BTN}>
                  Close
                </button>
              </div>
              {isLoadingUnassigned ? (
                <div className="text-xs text-gray-500 text-center py-3">Loading...</div>
              ) : unassignedJourneys.length === 0 ? (
                <div className="text-xs text-gray-500 text-center py-3">
                  All journeys are already assigned to trips
                </div>
              ) : (
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {unassignedJourneys.map((j) => (
                    <div
                      key={j.id}
                      className="p-2 bg-surface border border-gray-200 rounded text-xs flex items-center justify-between gap-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{j.name}</div>
                        <div className="text-gray-600 flex items-center gap-3 mt-0.5">
                          <span>{formatDateOnly(j.date)}</span>
                          <span>{Number(j.total_distance).toFixed(1)} km</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAssignJourney(j.id)}
                        className={`${btn("success", "xs")} flex-shrink-0`}
                      >
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!isEditing &&
            (deleteConfirm ? (
              <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
                <span className="flex-1 text-sm text-gray-700">
                  Delete this trip? Its journeys are kept.
                </span>
                <button
                  type="button"
                  onClick={handleDelete}
                  className={`${btn("danger")} flex-shrink-0`}
                >
                  Delete
                </button>
                <button
                  type="button"
                  ref={confirmCancelRef}
                  onClick={handleCancelDelete}
                  className={`${btn("subtle")} flex-shrink-0`}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-200">
                <button
                  type="button"
                  ref={editButtonRef}
                  onClick={handleStartEdit}
                  className={btn("outline")}
                >
                  Edit trip
                </button>
                <button
                  type="button"
                  ref={deleteButtonRef}
                  onClick={handleAskDelete}
                  className={btn("softDanger")}
                >
                  Delete trip
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
