import { requireUser } from "@/lib/api/auth";
import {
  optionalString,
  readJsonBody,
  requireIdParam,
  requireRegion,
  requireString,
} from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { deleteTripForUser, tripWithBoundsForUser, updateTripForUser } from "@/lib/tripQueries";

type Context = { params: Promise<{ id: string }> };

async function tripId(context: Context): Promise<number> {
  const { id } = await context.params;
  return requireIdParam(id, "trip id");
}

/**
 * GET /api/v1/trips/:id?region= — the trip, its journeys, the distinct track ids
 * across all of them (what the map highlights while the trip is open), and the
 * bounds of those in `region`, which the map fits to (`null` when none is there).
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const region = requireRegion(new URL(request.url));

    return jsonResponse(await tripWithBoundsForUser(user.id, await tripId(context), region));
  });
}

/** PATCH /api/v1/trips/:id — { name, description? }. */
export async function PATCH(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const id = await tripId(context);
    const body = await readJsonBody(request);

    const trip = await updateTripForUser(
      user.id,
      id,
      requireString(body, "name"),
      optionalString(body, "description"),
    );

    return jsonResponse({ trip });
  });
}

/** DELETE /api/v1/trips/:id — its journeys survive, unassigned. */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    await deleteTripForUser(user.id, await tripId(context));

    return jsonResponse({ success: true });
  });
}
