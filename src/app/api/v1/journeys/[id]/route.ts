import { requireUser } from "@/lib/api/auth";
import { optionalString, readJsonBody, requireIdParam, requireString } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { deleteJourneyForUser, journeyForUser, updateJourneyForUser } from "@/lib/journeyQueries";

type Context = { params: Promise<{ id: string }> };

async function journeyId(context: Context): Promise<number> {
  const { id } = await context.params;
  return requireIdParam(id, "journey id");
}

/** GET /api/v1/journeys/:id — the journey and the routes logged in it. */
export async function GET(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const { journey, routes } = await journeyForUser(user.id, await journeyId(context));

    return jsonResponse({ journey, routes });
  });
}

/** PATCH /api/v1/journeys/:id — { name, date, description? }. */
export async function PATCH(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const id = await journeyId(context);
    const body = await readJsonBody(request);

    const journey = await updateJourneyForUser(
      user.id,
      id,
      requireString(body, "name"),
      optionalString(body, "description"),
      requireString(body, "date"),
    );

    return jsonResponse({ journey });
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
