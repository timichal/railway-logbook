/**
 * The country list the map and its numbers are filtered by — the same rule
 * `RailwayMap` applies on the web (`effectiveCountries` there).
 *
 * A region the user can filter (Europe) uses their stored preference; one with a
 * single country pins it to the region's own list, which is what keeps the other
 * region's routes out of the view. Returns `null` while the preference is still on
 * its way: a request sent without it would answer for every country and the numbers
 * would jump when the real answer arrived.
 *
 * The preference itself is `CountryPrefsContext` and not a fetch of this hook's own —
 * the Countries screen writes it while the map is reading it, and two copies would
 * disagree.
 */

import { regionCountryCodes } from "@shared/regions";
import { useMemo } from "react";
import { useCountryPrefs } from "@/region/CountryPrefsContext";
import { useRegion } from "@/region/RegionContext";

export function useEffectiveCountries(): { countries: string[] | null; error: string | null } {
  const { region, regionId } = useRegion();
  const { selectedCountries, error } = useCountryPrefs();

  const filterable = region.hasCountryFilter;

  // Memoised because a caller keys an effect on this list: a region pinned to its
  // own countries would otherwise hand out a fresh array every render, and the
  // request that depends on it would fire in a loop.
  const countries = useMemo(
    () => (filterable ? selectedCountries : regionCountryCodes(regionId)),
    [filterable, selectedCountries, regionId],
  );

  // A region that ignores the preference is not blocked by having failed to read it.
  return { countries, error: filterable ? error : null };
}
