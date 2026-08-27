import { requireUser } from "@/lib/api/auth";
import { readJsonBody, requireStringArray } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { selectedCountriesForUser, updateSelectedCountriesForUser } from "@/lib/preferencesQueries";

/** GET /api/v1/preferences — the user's country filter, defaulted on first read. */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    return jsonResponse({ selectedCountries: await selectedCountriesForUser(user.id) });
  });
}

/**
 * PUT /api/v1/preferences — { selectedCountries }.
 *
 * A whole-list replacement rather than a patch: that is what the Countries tab
 * does (Select All / None included), and an empty list is a legitimate value.
 */
export async function PUT(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const body = await readJsonBody(request);
    const selectedCountries = requireStringArray(body, "selectedCountries");

    await updateSelectedCountriesForUser(user.id, selectedCountries);
    return jsonResponse({ selectedCountries });
  });
}
