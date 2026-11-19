import { requireUser } from "@/lib/api/auth";
import {
  optionalPositiveInt,
  optionalString,
  readJsonBody,
  requireIdParam,
  requireLoggedRoutes,
  requireRegion,
  requireString,
  requireTrackIdArray,
} from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import {
  deleteJourneyForUser,
  journeyWithBoundsForUser,
  saveJourneyEditsForUser,
} from "@/lib/journeyQueries";
import type { JourneyEdits } from "@/lib/shared/types";

type Context = { params: Promise<{ id: string }> };

async function journeyId(context: Context): Promise<number> {
  const { id } = await context.params;
  return requireIdParam(id, "journey id");
}

/**
 * GET /api/v1/journeys/:id?region= — the journey, the routes logged in it, and the
 * bounds of those in `region`: what the map fits to when the journey is opened
 * (`null` when none of them is there).
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const region = requireRegion(new URL(request.url));

    return jsonResponse(await journeyWithBoundsForUser(user.id, await journeyId(context), region));
  });
}

/**
 * PATCH /api/v1/journeys/:id — an edit of the journey as a whole, saved in one
 * transaction (`saveJourneyEditsForUser`, what the web's Route Logger saves with):
 * `{ name?, date?, description?, tripId?, upsert?, remove? }`. Only what the edit
 * changed is sent; a field left out keeps what the journey holds now. `upsert`
 * entries are `POST /journeys`' route objects, written as sent (a stretch left
 * out is none); `remove` is track ids. `tripId: null` files it under no trip.
 */
export async function PATCH(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const id = await journeyId(context);
    const body = await readJsonBody(request);

    const upsert = body.upsert === undefined ? null : requireLoggedRoutes(body, "upsert");
    const edits: JourneyEdits = {
      name: body.name === undefined ? undefined : requireString(body, "name"),
      date: body.date === undefined ? undefined : requireString(body, "date"),
      description: body.description === undefined ? undefined : optionalString(body, "description"),
      tripId: body.tripId === undefined ? undefined : optionalPositiveInt(body, "tripId"),
      upsert: upsert
        ? upsert.trackIds.map((trackId, i) => ({
            trackId,
            partial: upsert.partialFlags[i],
            range: upsert.coveredRanges[i],
          }))
        : [],
      remove: body.remove === undefined ? [] : requireTrackIdArray(body, "remove"),
    };
    await saveJourneyEditsForUser(user.id, id, edits);

    return jsonResponse({ success: true });
  });
}

/** DELETE /api/v1/journeys/:id — the journey and its logged parts. */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    await deleteJourneyForUser(user.id, await journeyId(context));

    return jsonResponse({ success: true });
  });
}
