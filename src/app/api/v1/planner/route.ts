import { readJsonBody, requireInt, requireIntArray } from "@/lib/api/params";
import { ApiError, apiHandler, jsonResponse } from "@/lib/api/response";
import { findRoutePathBetweenStations } from "@/lib/routePathFinder";
import { MAX_VIA_STATIONS } from "@/lib/shared/constants";

/**
 * POST /api/v1/planner — { fromStationId, toStationId, viaStationIds? }.
 *
 * The search stays on the server for good: it needs Postgres and the in-memory
 * route graph, neither of which belongs on a phone.
 *
 * "No path found" comes back as a 200 with an `error` string rather than as an
 * HTTP failure — the request was fine, the network just doesn't connect those
 * stations, and the app shows that message next to the form the way the web app
 * does.
 *
 * It is the one handler that takes no session, which is why `viaStationIds` is
 * capped here as well: each via station is another search over the whole route
 * graph, and `requireIntArray`'s generic 2000-item ceiling is far too much to
 * hand an anonymous caller. Over the cap is a malformed request, so it is a 400
 * rather than the in-band `error` an unreachable station gets.
 */
export async function POST(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const body = await readJsonBody(request);

    const fromStationId = requireInt(body, "fromStationId");
    const toStationId = requireInt(body, "toStationId");
    const viaStationIds =
      body.viaStationIds === undefined || body.viaStationIds === null
        ? []
        : requireIntArray(body, "viaStationIds");
    if (viaStationIds.length > MAX_VIA_STATIONS) {
      throw new ApiError(400, `viaStationIds must hold at most ${MAX_VIA_STATIONS} items`);
    }

    return jsonResponse(
      await findRoutePathBetweenStations(fromStationId, toStationId, viaStationIds),
    );
  });
}
