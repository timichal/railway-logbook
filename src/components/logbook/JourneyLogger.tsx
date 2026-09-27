"use client";

import RouteLogger, {
  type NewJourney,
  type RouteSelectionProps,
} from "@/components/logbook/RouteLogger";
import { useAsyncLoad } from "@/hooks/useAsyncLoad";
import { unwrap } from "@/lib/actionResult";
import { createJourney } from "@/lib/journeyActions";
import { useRegionId } from "@/lib/regionContext";
import type { TripWithStats } from "@/lib/tripActions";
import { getAllTrips } from "@/lib/tripActions";

const NO_TRIPS: TripWithStats[] = [];

async function createAccountJourney(journey: NewJourney): Promise<string> {
  const { journey: created } = unwrap(
    await createJourney(
      journey.name,
      journey.description,
      journey.date,
      journey.routes.map((r) => r.track_id),
      journey.routes.map((r) => r.partial ?? false),
      journey.tripId,
      // Ridden stretch, known only for routes the Journey Planner joined mid-way
      journey.routes.map((r) =>
        r.covered
          ? { covered_start: r.covered.covered_start, covered_end: r.covered.covered_end }
          : null,
      ),
    ),
  );
  return `Journey "${created?.name}" created successfully!`;
}

/** The Route Logger of a signed-in user: journeys go to the account, and may be filed under a trip. */
export default function JourneyLogger(props: RouteSelectionProps) {
  const regionId = useRegionId();
  // Trips are region-scoped. A failed load leaves the picker empty, which only
  // costs filing the journey under a trip later.
  const { data: availableTrips } = useAsyncLoad(
    () =>
      getAllTrips(regionId)
        .then(unwrap)
        .then((result) => result.trips),
    [regionId],
    "trips",
  );

  return (
    <RouteLogger {...props} trips={availableTrips ?? NO_TRIPS} onCreate={createAccountJourney} />
  );
}
