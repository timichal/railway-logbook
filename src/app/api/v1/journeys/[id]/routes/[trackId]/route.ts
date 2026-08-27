import { requireUser } from "@/lib/api/auth";
import { readJsonBody, requireBoolean, requireIdParam } from "@/lib/api/params";
import { apiHandler, assertOk, jsonResponse } from "@/lib/api/response";
import {
  removeRouteFromJourneyForUser,
  updateLoggedPartPartialForUser,
} from "@/lib/journeyQueries";

type Context = { params: Promise<{ id: string; trackId: string }> };

async function ids(context: Context): Promise<{ journeyId: number; trackId: number }> {
  const { id, trackId } = await context.params;
  return {
    journeyId: requireIdParam(id, "journey id"),
    trackId: requireIdParam(trackId, "track id"),
  };
}

/**
 * PATCH /api/v1/journeys/:id/routes/:trackId — { partial }.
 *
 * Only the flag: the ridden stretch is written when the route is logged and is
 * not editable after the fact (the same as on the web, where unticking partial
 * claims the whole route).
 */
export async function PATCH(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const { journeyId, trackId } = await ids(context);
    const body = await readJsonBody(request);

    const result = await updateLoggedPartPartialForUser(
      user.id,
      journeyId,
      trackId,
      requireBoolean(body, "partial"),
    );
    assertOk(result);

    return jsonResponse({ success: true });
  });
}

/** DELETE /api/v1/journeys/:id/routes/:trackId — unlog one route. */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const { journeyId, trackId } = await ids(context);

    const result = await removeRouteFromJourneyForUser(user.id, journeyId, trackId);
    assertOk(result);

    return jsonResponse({ success: true });
  });
}
