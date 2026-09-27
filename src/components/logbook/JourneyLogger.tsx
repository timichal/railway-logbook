"use client";

import { useEffect, useState } from "react";
import RouteLogger, {
  type NewJourney,
  type RouteSelectionProps,
} from "@/components/logbook/RouteLogger";
import { createJourney } from "@/lib/journeyActions";
import { useRegionId } from "@/lib/regionContext";
import type { TripWithStats } from "@/lib/tripActions";
import { getAllTrips } from "@/lib/tripActions";

async function createAccountJourney(journey: NewJourney): Promise<string> {
  const result = await createJourney(
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
  );
  if (result.error) throw new Error(result.error);
  return `Journey "${result.journey?.name}" created successfully!`;
}

/** The Route Logger of a signed-in user: journeys go to the account, and may be filed under a trip. */
export default function JourneyLogger(props: RouteSelectionProps) {
  const regionId = useRegionId();
  const [availableTrips, setAvailableTrips] = useState<TripWithStats[]>([]);

  // Trips are region-scoped
  useEffect(() => {
    let cancelled = false;
    setAvailableTrips([]);
    getAllTrips(regionId).then((result) => {
      if (!cancelled && !result.error) setAvailableTrips(result.trips || []);
    });
    return () => {
      cancelled = true;
    };
  }, [regionId]);

  return <RouteLogger {...props} trips={availableTrips} onCreate={createAccountJourney} />;
}
