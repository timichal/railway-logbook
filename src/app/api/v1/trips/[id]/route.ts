import { requireUser } from "@/lib/api/auth";
import { optionalString, readJsonBody, requireIdParam, requireString } from "@/lib/api/params";
import { apiHandler, assertOk, jsonResponse } from "@/lib/api/response";
import { deleteTripForUser, tripForUser, updateTripForUser } from "@/lib/tripQueries";

type Context = { params: Promise<{ id: string }> };

async function tripId(context: Context): Promise<number> {
  const { id } = await context.params;
  return requireIdParam(id, "trip id");
}

/**
 * GET /api/v1/trips/:id — the trip, its journeys, and the distinct track ids
 * across all of them (what the map highlights while the trip is open).
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const result = await tripForUser(user.id, await tripId(context));
    assertOk(result);

    return jsonResponse({
      trip: result.trip,
      journeys: result.journeys,
      routeIds: result.routeIds,
    });
  });
}

/** PATCH /api/v1/trips/:id — { name, description? }. */
export async function PATCH(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const id = await tripId(context);
    const body = await readJsonBody(request);

    const result = await updateTripForUser(
      user.id,
      id,
      requireString(body, "name"),
      optionalString(body, "description"),
    );
    assertOk(result);

    return jsonResponse({ trip: result.trip });
  });
}

/** DELETE /api/v1/trips/:id — its journeys survive, unassigned. */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const result = await deleteTripForUser(user.id, await tripId(context));
    assertOk(result);

    return jsonResponse({ success: true });
  });
}
