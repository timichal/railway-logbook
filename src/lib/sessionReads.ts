/**
 * The signed-in web page's reads of its own data, from the `api/me` route
 * handlers rather than from server actions: Next runs a client's actions one at a
 * time, so as actions the page's loads queued behind each other and behind any
 * slow one. Writes stay server actions.
 *
 * A refusal is thrown as an `ActionError` (`fetchJson.ts`).
 */

import { fetchJson, listParam, queryString } from "./fetchJson";
import type { ProgressByCountry, UserProgress } from "./shared/progress";
import type { RegionId } from "./shared/regions";
import type { CoveredStretch } from "./shared/types";
import type { TripName } from "./tripQueries";

function getMine<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
  return fetchJson<T>(`/api/me/${path}?${queryString(params)}`, { cache: "no-store" });
}

export function fetchProgress(
  region: RegionId,
  selectedCountries?: string[],
  shownUsageTypes?: readonly number[],
): Promise<UserProgress> {
  return getMine("progress", {
    region,
    countries: listParam(selectedCountries),
    usage: listParam(shownUsageTypes),
  });
}

export function fetchProgressByCountry(region: RegionId): Promise<ProgressByCountry> {
  return getMine("progress/by-country", { region });
}

export function fetchCoveredStretches(region: RegionId): Promise<CoveredStretch[]> {
  return getMine("coverage", { region });
}

export function fetchTripNames(region: RegionId): Promise<TripName[]> {
  return getMine("trip-names", { region });
}
