"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CardActions from "@/components/logbook/CardActions";
import CardHeader from "@/components/logbook/CardHeader";
import JourneyChainList from "@/components/logbook/JourneyChainList";
import LoggedRouteRow from "@/components/logbook/LoggedRouteRow";
import { ActionError, actionErrorMessage } from "@/lib/actionResult";
import { journeyChains } from "@/lib/journeyChains";
import { selectionFromJourney, useJourneyEditDraft } from "@/lib/journeyEdit";
import type { JourneyStore, LoadedJourney } from "@/lib/journeyStore";
import { plural } from "@/lib/plural";
import { useRegionId } from "@/lib/regionContext";
import { formatDateOnly } from "@/lib/shared/getUntimezonedDateStr";
import { routeTitle } from "@/lib/shared/map/routeFeature";
import { knownStretches } from "@/lib/shared/routeCoverage";
import type { HighlightOptions, HighlightRoutesFn, RailwayRoute } from "@/lib/shared/types";
import { useToast } from "@/lib/toast";
import { btn, LINK_BTN } from "@/lib/ui/buttonStyles";

/** What the list knows of a journey before it is opened. */
interface JourneySummary<Id> {
  id: Id;
  name: string;
  description: string | null;
  date: string;
  trip_id?: number | null;
  route_count: number;
  /** Left out where the list doesn't know it (the local journeys). */
  total_distance?: number;
}

interface JourneyCardProps<Id> {
  journey: JourneySummary<Id>;
  store: JourneyStore<Id>;
  // Tells parent whether this card is the currently-open one. Parent enforces single-open.
  isOpen: boolean;
  onRequestOpen: () => void;
  onRequestClose: () => void;
  // Mutation lifecycle
  onChanged: () => void; // After a delete — refresh the list and map
  // Map interaction
  onHighlightRoutes?: HighlightRoutesFn;
  /** Edit pressed: the journey's draft is written, and the Route Logger takes it up. */
  onEditJourney?: (id: Id) => void;
  // Visual nesting (when rendered inside a trip card)
  nested?: boolean;
}

/**
 * One journey of My Trips / My Journeys. Open, it shows the lines of stations it
 * rode (`journeyChains`), and on request every route; Edit takes it to the Route
 * Logger (journeyEdit.ts), where it is edited as a selection with the planner and
 * every option a new journey has.
 */
export default function JourneyCard<Id extends number | string>({
  journey,
  store,
  isOpen,
  onRequestOpen,
  onRequestClose,
  onChanged,
  onHighlightRoutes,
  onEditJourney,
  nested = false,
}: JourneyCardProps<Id>) {
  const { showSuccess, showError } = useToast();
  const regionId = useRegionId();

  // The journey as last loaded: null until the card opens and its load answers
  const [loaded, setLoaded] = useState<LoadedJourney | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const isLoading = loaded === null && !loadFailed;
  // The chain shown on its own on the map, and whether every route is listed
  const [pickedChain, setPickedChain] = useState<number | null>(null);
  const [showRoutes, setShowRoutes] = useState(false);

  // An edit of it in the Route Logger, kept there until saved or cancelled
  const { draft, changed, setDraft } = useJourneyEditDraft(journey.id);

  const editButtonRef = useRef<HTMLButtonElement>(null);
  const routes = loaded?.routes ?? [];
  const chains = useMemo(() => journeyChains(routes), [routes]);

  /**
   * Light up `shown` on the map. A route logged in part lights up only along its
   * stretch; one ticked partial by hand has no stretch, and is drawn whole.
   */
  const highlight = (from: LoadedJourney, shown: RailwayRoute[], options?: HighlightOptions) => {
    const stretches = knownStretches(shown);
    const partials = from.partials.filter((p) =>
      stretches.some(
        (s) =>
          s.track_id === p.track_id &&
          s.covered_start === p.covered_start &&
          s.covered_end === p.covered_end,
      ),
    );
    onHighlightRoutes?.(
      shown.map((r) => r.track_id),
      "view",
      partials,
      options,
    );
  };

  // Load the journey when this card opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: highlight, setDraft and regionId are intentionally omitted; the effect should fire only when the card opens, the journey changes or a retry is asked for, not when a callback identity changes, and the region only scopes the fit that opening does.
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setLoadFailed(false);
    (async () => {
      try {
        const result = await store.load(journey.id, regionId);
        if (cancelled) return;
        setLoaded(result);
        highlight(result, result.routes, { fit: true, bounds: result.bounds });
      } catch (error) {
        if (cancelled) return;
        console.error("Error loading journey:", error);
        showError(actionErrorMessage(error, "Failed to load journey"));
        // Gone: an edit of it has nothing left to be saved to
        if (error instanceof ActionError && error.notFound) setDraft(null);
        setLoadFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, journey.id, store, loadAttempt]);

  // When this card closes, forget what it loaded; the parent clears the highlight
  useEffect(() => {
    if (isOpen) return;
    setLoaded(null);
    setLoadFailed(false);
    setPickedChain(null);
    setShowRoutes(false);
  }, [isOpen]);

  const handlePickChain = (index: number | null) => {
    if (!loaded) return;
    setPickedChain(index);
    if (index === null) {
      highlight(loaded, loaded.routes, { fit: true, bounds: loaded.bounds });
      return;
    }
    const ids = new Set(chains[index]?.trackIds);
    highlight(
      loaded,
      loaded.routes.filter((route) => ids.has(route.track_id)),
      { fit: true },
    );
  };

  const handleEdit = () => {
    if (!loaded) return;
    // An edit already under way is taken up as it stands
    if (!draft) {
      const snapshot = {
        name: loaded.journey.name,
        date: loaded.journey.date,
        description: loaded.journey.description ?? "",
        tripId: loaded.journey.trip_id ?? null,
        routes: selectionFromJourney(loaded.routes, loaded.partials),
      };
      setDraft({ base: snapshot, edit: snapshot });
    }
    onEditJourney?.(journey.id);
  };

  const handleDelete = async () => {
    try {
      await store.remove(journey.id);
      showSuccess("Journey deleted");
      setDraft(null);
      onRequestClose();
      onChanged();
      return true;
    } catch (error) {
      console.error("Error deleting journey:", error);
      showError(actionErrorMessage(error, "Failed to delete journey"));
      return false;
    }
  };

  return (
    <div
      className={`border rounded shadow-sm ${nested ? "bg-gray-50 border-gray-200" : "bg-surface border-gray-300"}`}
    >
      <CardHeader
        title={journey.name}
        description={journey.description}
        meta={[
          formatDateOnly(journey.date),
          plural(journey.route_count, "route"),
          journey.total_distance !== undefined && `${journey.total_distance.toFixed(1)} km`,
        ]
          .filter(Boolean)
          .join(" · ")}
        isOpen={isOpen}
        onToggle={isOpen ? onRequestClose : onRequestOpen}
        unsaved={changed}
      />

      {isOpen && (
        <div className="px-3 pb-3 pt-2 border-t border-gray-200 space-y-3">
          {loadFailed ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 text-xs text-gray-600">Couldn't load this journey.</span>
              <button
                type="button"
                onClick={() => setLoadAttempt((n) => n + 1)}
                className={`${btn("subtle", "xs")} flex-shrink-0`}
              >
                Retry
              </button>
            </div>
          ) : isLoading ? (
            <div className="text-xs text-gray-500 text-center py-2">Loading…</div>
          ) : (
            <>
              {routes.length === 0 ? (
                <p className="text-xs text-gray-500 italic">No routes in this journey.</p>
              ) : (
                <>
                  <JourneyChainList chains={chains} picked={pickedChain} onPick={handlePickChain} />
                  <button
                    type="button"
                    onClick={() => setShowRoutes((shown) => !shown)}
                    aria-expanded={showRoutes}
                    className={LINK_BTN}
                  >
                    {showRoutes ? "Hide routes" : `Show all ${plural(routes.length, "route")}`}
                  </button>
                  {showRoutes && (
                    <div className="space-y-1">
                      {routes.map((route) => {
                        // A naming region leads with the line name, endpoints beneath
                        const { name, endpoints } = routeTitle(route, regionId);
                        return (
                          <LoggedRouteRow
                            key={route.track_id}
                            title={name ?? endpoints}
                            subtitle={name ? endpoints : undefined}
                            lengthKm={route.length_km}
                            partial={route.partial ?? false}
                            covered={{ start: route.covered_start, end: route.covered_end }}
                          />
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {draft && (
                <p className="text-xs text-gray-600">
                  {changed
                    ? "Has unsaved changes in the Route Logger."
                    : "Open for editing in the Route Logger."}
                </p>
              )}

              <CardActions
                editLabel={draft ? "Continue editing" : "Edit"}
                editVariant="primary"
                editButtonRef={editButtonRef}
                onEdit={handleEdit}
                deleteLabel="Delete"
                question="Delete this journey?"
                onDelete={handleDelete}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
