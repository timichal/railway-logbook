/**
 * The signed-in web page's reads of its own data, from the `api/me` route
 * handlers rather than from server actions: Next runs a client's actions one at a
 * time, so as actions the page's loads queued behind each other and behind any
 * slow one. Writes stay server actions.
 *
 * A refusal comes back as the `{ error }` body `apiHandler` writes, and is thrown
 * here as an `ActionError`, so call sites read it exactly as they read an
 * `unwrap`ped action (`actionErrorMessage`; `notFound` on a 404).
 */

import { ActionError } from "./actionResult";
import type { ProgressByCountry, UserProgress } from "./shared/progress";
import type { RegionId } from "./shared/regions";
import type { CoveredStretch } from "./shared/types";
import type { TripName } from "./tripQueries";

async function getMine<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) query.set(name, value);
  }

  const response = await fetch(`/api/me/${path}?${query}`, { cache: "no-store" });
  if (response.ok) return (await response.json()) as T;

  const body: unknown = await response.json().catch(() => null);
  const message =
    body !== null && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : null;
  // Only a message the handler wrote for the user is one; a 500's is opaque anyway
  if (message !== null && response.status < 500) {
    throw new ActionError(message, response.status === 404);
  }
  throw new Error(`api/me/${path}: HTTP ${response.status}`);
}

/**
 * A list parameter keeping its three states: undefined (no filter) leaves it out,
 * [] (filter out everything) sends it empty.
 */
const listParam = (values: readonly (string | number)[] | undefined) => values?.join(",");

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
