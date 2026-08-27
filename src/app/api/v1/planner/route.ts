import { readJsonBody, requireInt, requireIntArray } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { findRoutePathBetweenStations } from "@/lib/routePathFinder";

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

    return jsonResponse(
      await findRoutePathBetweenStations(fromStationId, toStationId, viaStationIds),
    );
  });
}
