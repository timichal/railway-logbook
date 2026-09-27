"use client";

import RouteLogger, {
  type NewJourney,
  type RouteSelectionProps,
} from "@/components/logbook/RouteLogger";
import * as localStore from "@/lib/localStorage";

async function createLocalJourney(journey: NewJourney): Promise<string> {
  const newJourney = localStore.addJourney({
    name: journey.name,
    description: journey.description,
    date: journey.date,
  });

  localStore.addLoggedParts(
    journey.routes.map((r) => {
      const partial = r.partial ?? false;
      return {
        journey_id: newJourney.id,
        track_id: r.track_id,
        partial,
        // Only a partial ride has a meaningful stretch, and only the Journey
        // Planner knows one
        covered_start: partial && r.covered ? r.covered.covered_start : null,
        covered_end: partial && r.covered ? r.covered.covered_end : null,
      };
    }),
  );

  return `Journey "${newJourney.name}" created successfully! (${localStore.getJourneyCount()}/${localStore.MAX_JOURNEYS} journeys used)`;
}

/** The Route Logger of an anonymous visitor: journeys go to localStorage, up to its limit. */
export default function LocalTripLogger(props: RouteSelectionProps) {
  // Read on every render: a save re-renders this through the cleared selection
  const journeyCount = localStore.getJourneyCount();
  const remainingJourneys = localStore.MAX_JOURNEYS - journeyCount;

  const notice = (
    <div
      className={`text-xs px-3 py-2 rounded border ${
        remainingJourneys <= 2
          ? "bg-orange-50 border-orange-200 text-orange-800"
          : "bg-blue-50 border-blue-200 text-blue-700"
      }`}
    >
      <div className="font-medium mb-1">
        Local Storage ({journeyCount}/{localStore.MAX_JOURNEYS} journeys)
      </div>
      <div className="text-xs">
        {remainingJourneys > 0
          ? `${remainingJourneys} journey${remainingJourneys === 1 ? "" : "s"} remaining. Create an account for unlimited journeys!`
          : "Limit reached! Create an account to log more journeys."}
      </div>
    </div>
  );

  return (
    <RouteLogger
      {...props}
      notice={notice}
      blockedReason={remainingJourneys > 0 ? null : localStore.JOURNEY_LIMIT_MESSAGE}
      onCreate={createLocalJourney}
    />
  );
}
