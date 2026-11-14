/**
 * A shared map's reads (`/shared/<token>`), from the `api/shared/<token>` route
 * handlers rather than from server actions, for the reason `sessionReads.ts`
 * gives. Each call re-resolves the token on the server, so a link switched off
 * mid-visit stops answering: a 404, thrown as an `ActionError` (`notFound`).
 */

import { getNoStore, listParam } from "./fetchJson";
import type { ProgressByCountry, UserProgress } from "./shared/progress";
import type { RegionId } from "./shared/regions";
import type { CoveredStretch } from "./shared/types";

function getShared<T>(
  token: string,
  path: string,
  params: Record<string, string | undefined>,
): Promise<T> {
  return getNoStore(`/api/shared/${encodeURIComponent(token)}/${path}`, params);
}

export function fetchSharedProgress(
  token: string,
  region: RegionId,
  selectedCountries?: string[],
  shownUsageTypes?: readonly number[],
): Promise<UserProgress> {
  return getShared(token, "progress", {
    region,
    countries: listParam(selectedCountries),
    usage: listParam(shownUsageTypes),
  });
}

export function fetchSharedProgressByCountry(
  token: string,
  region: RegionId,
): Promise<ProgressByCountry> {
  return getShared(token, "progress/by-country", { region });
}

export function fetchSharedCoveredStretches(
  token: string,
  region: RegionId,
): Promise<CoveredStretch[]> {
  return getShared(token, "coverage", { region });
}
