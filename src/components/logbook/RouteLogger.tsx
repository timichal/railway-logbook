"use client";

import { type ReactNode, useState } from "react";
import JourneyMetaFields from "@/components/logbook/JourneyMetaFields";
import JourneyPlanner from "@/components/logbook/JourneyPlanner";
import { useRegionId } from "@/lib/regionContext";
import {
  loggedLengthKm,
  NEW_JOURNEY_FORM_ID,
  type PlannedLeg,
  type PlannedStops,
  selectionLengthKm,
  suggestJourneyName,
} from "@/lib/selectedRoutes";
import { routeTitle } from "@/lib/shared/map/routeFeature";
import type { HighlightRoutesFn, PlannerRoute, SelectedRoute, Station } from "@/lib/shared/types";
import { useToast } from "@/lib/toast";
import { btn, iconBtn, LINK_BTN } from "@/lib/ui/buttonStyles";
import { useTodayDefault } from "@/lib/useTodayDefault";

/** What the Route Logger tab is handed by the sidebar, signed in or not. */
export interface RouteSelectionProps {
  selectedRoutes: SelectedRoute[];
  onRemoveRoute: (trackId: number) => void;
  onClearSelection: () => void;
  onUpdateRoutePartial: (trackId: number, partial: boolean) => void;
  onRoutesLogged: () => void;
  onHighlightRoutes?: HighlightRoutesFn;
  onAddRoutesFromPlanner?: (routes: PlannerRoute[]) => void;
  onStationClickHandler?: (handler: ((station: Station | null) => void) | null) => void;
}

export interface NewJourney {
  name: string;
  description: string | null;
  date: string;
  /** Always null where no trips are offered. */
  tripId: number | null;
  routes: SelectedRoute[];
}

interface RouteLoggerProps extends RouteSelectionProps {
  /** Saves the journey and resolves to the success message; throws to refuse. */
  onCreate: (journey: NewJourney) => Promise<string>;
  /** The trips a journey can be filed under; the field is shown only when there are some. */
  trips?: { id: number; name: string }[];
  /** Drawn above the form. */
  notice?: ReactNode;
  /** Why no journey can be created right now; disables the submit button. */
  blockedReason?: string | null;
}

/**
 * The Route Logger tab: the Journey Planner, the routes picked on the map and the
 * new-journey form. Where the journey goes — the account or localStorage — is the
 * caller's `onCreate`, which is the whole of the difference between `JourneyLogger`
 * and `LocalTripLogger`.
 */
export default function RouteLogger({
  selectedRoutes,
  onRemoveRoute,
  onClearSelection,
  onUpdateRoutePartial,
  onRoutesLogged,
  onHighlightRoutes,
  onAddRoutesFromPlanner,
  onStationClickHandler,
  onCreate,
  trips,
  notice,
  blockedReason,
}: RouteLoggerProps) {
  const { showSuccess, showError } = useToast();
  const [journeyName, setJourneyName] = useState("");
  const {
    value: journeyDate,
    setValue: setJourneyDate,
    reset: resetJourneyDate,
    refresh: refreshJourneyDate,
  } = useTodayDefault();
  const [journeyDescription, setJourneyDescription] = useState("");
  const [pickedTripId, setPickedTripId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  /** The plans added to the selection, for the name suggestion (see suggestJourneyName). */
  const [plannedLegs, setPlannedLegs] = useState<PlannedLeg[]>([]);

  // An emptied selection — cleared, logged, or its last route removed — has no use
  // for the plans that filled it
  if (selectedRoutes.length === 0 && plannedLegs.length > 0) setPlannedLegs([]);

  const handleAddFromPlanner = (routes: PlannerRoute[], stops: PlannedStops) => {
    // Only the routes this plan brings in: one whose routes were all picked already
    // added nothing, and says nothing about the journey's name
    const trackIds = routes
      .map((route) => route.track_id)
      .filter((id) => !selectedRoutes.some((route) => route.track_id === id));
    if (trackIds.length > 0) setPlannedLegs((legs) => [...legs, { stops, trackIds }]);
    onAddRoutesFromPlanner?.(routes);
  };

  const suggestedName = suggestJourneyName(plannedLegs, selectedRoutes);

  // A pick counts only while it is still offered: trips are region-scoped, so a
  // region switch replaces the list and leaves the old pick naming nothing here
  const journeyTripId = trips?.some((trip) => trip.id === pickedTripId) ? pickedTripId : null;

  // In the order the tab asks for them
  const missingField =
    selectedRoutes.length === 0
      ? "Select at least one route, on the map or with the planner"
      : !journeyName.trim()
        ? "Give the journey a name"
        : !journeyDate
          ? "Pick the journey's date"
          : null;
  const disabledReason = blockedReason || missingField;

  const handleCreateJourney = async () => {
    if (missingField) {
      showError("Please fill in journey name, date, and select at least one route");
      return;
    }

    setIsSaving(true);
    try {
      const message = await onCreate({
        name: journeyName.trim(),
        description: journeyDescription.trim() || null,
        date: journeyDate,
        tripId: journeyTripId,
        routes: selectedRoutes,
      });

      setJourneyName("");
      resetJourneyDate();
      setJourneyDescription("");
      setPickedTripId(null);
      onClearSelection();
      onRoutesLogged();

      showSuccess(message);
    } catch (error) {
      console.error("Error creating journey:", error);
      showError(error instanceof Error ? error.message : "Failed to create journey");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 text-fg space-y-4">
      {notice}

      {/* In the order of the task: find the routes, check them, then name the journey */}
      <JourneyPlanner
        onHighlightRoutes={onHighlightRoutes}
        onAddRoutesToSelection={onAddRoutesFromPlanner && handleAddFromPlanner}
        onStationClickHandler={onStationClickHandler}
      />

      <SelectedRoutesList
        routes={selectedRoutes}
        onRemoveRoute={onRemoveRoute}
        onClearSelection={onClearSelection}
        onUpdateRoutePartial={onUpdateRoutePartial}
      />

      <div id={NEW_JOURNEY_FORM_ID} className="pt-3 border-t border-gray-200">
        <h3 className="text-lg font-bold mb-3">New Journey</h3>
        <JourneyMetaFields
          idPrefix="new-journey"
          name={journeyName}
          onNameChange={setJourneyName}
          suggestedName={suggestedName}
          date={journeyDate}
          onDateChange={setJourneyDate}
          onDateFocus={refreshJourneyDate}
          description={journeyDescription}
          onDescriptionChange={setJourneyDescription}
          trip={
            trips && trips.length > 0
              ? { value: journeyTripId, options: trips, onChange: setPickedTripId }
              : undefined
          }
        />
      </div>

      <div>
        <button
          type="button"
          onClick={handleCreateJourney}
          disabled={isSaving || !!disabledReason}
          aria-describedby={disabledReason && !isSaving ? "new-journey-blocked" : undefined}
          className={`${btn("success", "md")} w-full`}
        >
          {isSaving
            ? "Creating..."
            : selectedRoutes.length === 0
              ? "Create Journey"
              : `Create Journey & Log ${selectedRoutes.length} Route${selectedRoutes.length === 1 ? "" : "s"}`}
        </button>
        {/* Written out, not a `title`: a tooltip never shows on touch */}
        {disabledReason && !isSaving && (
          <p id="new-journey-blocked" className="mt-1.5 text-xs text-gray-500 text-center">
            {disabledReason}
          </p>
        )}
      </div>
    </div>
  );
}

interface SelectedRoutesListProps {
  routes: SelectedRoute[];
  onRemoveRoute: (trackId: number) => void;
  onClearSelection: () => void;
  onUpdateRoutePartial: (trackId: number, partial: boolean) => void;
}

function SelectedRoutesList({
  routes,
  onRemoveRoute,
  onClearSelection,
  onUpdateRoutePartial,
}: SelectedRoutesListProps) {
  const regionId = useRegionId();
  const totalDistance = selectionLengthKm(routes);

  return (
    <div className="pt-3 border-t border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Selected Routes ({routes.length})</h3>
        {routes.length > 0 && (
          <button type="button" onClick={onClearSelection} className={LINK_BTN}>
            Clear selection
          </button>
        )}
      </div>

      {routes.length === 0 ? (
        <div className="text-sm text-gray-500 text-center py-8 bg-gray-50 rounded border border-gray-200">
          Click routes on the map to add them here
        </div>
      ) : (
        <>
          <div className="space-y-1 mb-3 max-h-64 overflow-y-auto">
            {routes.map((route) => {
              // A naming region leads with the line name, endpoints beneath
              const { name, endpoints } = routeTitle(route, regionId);
              return (
                <div
                  key={route.track_id}
                  className="p-2 bg-gray-50 border border-gray-200 rounded text-xs flex items-start justify-between gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{name ?? endpoints}</div>
                    {name && <div className="text-gray-500 truncate">{endpoints}</div>}
                    <div className="flex items-center gap-4 mt-1">
                      <span className="text-gray-600">
                        {loggedLengthKm(route).toFixed(1)} km
                        {route.partial && route.travelled_length_km != null && (
                          <span className="text-amber-700"> of {route.length_km.toFixed(1)}</span>
                        )}
                      </span>
                      <label className="flex items-center gap-1.5 text-xs text-gray-700 min-h-11 md:min-h-0 pr-2 md:pr-0">
                        <input
                          type="checkbox"
                          checked={route.partial ?? false}
                          onChange={(e) => onUpdateRoutePartial(route.track_id, e.target.checked)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                        />
                        <span>Partial</span>
                      </label>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onRemoveRoute(route.track_id)}
                      className={`${iconBtn("responsive")} -my-2 -mr-1 md:my-0 md:mr-0 text-lg`}
                      title="Remove route"
                      aria-label="Remove route"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-xs text-gray-600 mb-3 flex justify-between items-center bg-blue-50 px-3 py-2 rounded border border-blue-200">
            <span className="font-medium">Total Distance:</span>
            <span className="font-bold text-blue-700">{totalDistance.toFixed(1)} km</span>
          </div>
        </>
      )}
    </div>
  );
}
