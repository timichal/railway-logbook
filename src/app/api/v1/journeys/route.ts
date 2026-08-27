import { requireUser } from "@/lib/api/auth";
import {
  optionalPositiveInt,
  optionalString,
  readJsonBody,
  requireLoggedRoutes,
  requireString,
} from "@/lib/api/params";
import { apiHandler, assertOk, jsonResponse } from "@/lib/api/response";
import { createJourneyForUser } from "@/lib/journeyQueries";

/**
 * POST /api/v1/journeys — log a journey.
 *
 * `{ name, date, description?, tripId?, routes: [{ trackId, partial?, covered? }] }`.
 * Journey and logged parts are written in one transaction, so a journey never
 * half-exists.
 */
export async function POST(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const body = await readJsonBody(request);

    const { trackIds, partialFlags, coveredRanges } = requireLoggedRoutes(body, "routes");

    const result = await createJourneyForUser(
      user.id,
      requireString(body, "name"),
      optionalString(body, "description"),
      requireString(body, "date"),
      trackIds,
      partialFlags,
      optionalPositiveInt(body, "tripId"),
      coveredRanges,
    );
    assertOk(result);

    return jsonResponse({ journey: result.journey }, 201);
  });
}
