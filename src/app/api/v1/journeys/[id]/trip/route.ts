import { requireUser } from "@/lib/api/auth";
import { readJsonBody, requireIdParam, requirePositiveInt } from "@/lib/api/params";
import { apiHandler, assertOk, jsonResponse } from "@/lib/api/response";
import { assignJourneyToTripForUser, unassignJourneyFromTripForUser } from "@/lib/tripQueries";

type Context = { params: Promise<{ id: string }> };

async function journeyId(context: Context): Promise<number> {
  const { id } = await context.params;
  return requireIdParam(id, "journey id");
}

/**
 * PUT /api/v1/journeys/:id/trip — { tripId }.
 *
 * Keyed on the journey because the journey is what changes: `trip_id` is a
 * column on it, and a journey belongs to at most one trip.
 */
export async function PUT(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const id = await journeyId(context);
    const body = await readJsonBody(request);
    const tripId = requirePositiveInt(body, "tripId");

    const result = await assignJourneyToTripForUser(user.id, id, tripId);
    assertOk(result);

    return jsonResponse({ success: true });
  });
}

/** DELETE /api/v1/journeys/:id/trip — file the journey under no trip. */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const result = await unassignJourneyFromTripForUser(user.id, await journeyId(context));
    assertOk(result);

    return jsonResponse({ success: true });
  });
}
