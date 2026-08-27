/**
 * The country list the region's numbers are filtered by — the same rule
 * `RailwayMap` applies on the web (`effectiveCountries` there).
 *
 * A region the user can filter (Europe) uses their stored preference; one with a
 * single country pins it to the region's own list, which is what keeps the other
 * region's routes out of the view. Returns `null` while the preference is still on
 * its way: a request sent without it would answer for every country and the numbers
 * would jump when the real answer arrived.
 */

import { regionCountryCodes } from "@shared/regions";
import { useEffect, useMemo, useState } from "react";
import * as api from "@/api/endpoints";
import { useRegion } from "@/region/RegionContext";

export function useEffectiveCountries(): { countries: string[] | null; error: string | null } {
  const { region, regionId } = useRegion();
  const [stored, setStored] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filterable = region.hasCountryFilter;

  useEffect(() => {
    if (!filterable) return;

    let cancelled = false;
    api
      .preferences()
      .then((countries) => {
        if (!cancelled) setStored(countries);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not load your countries.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filterable]);

  // Memoised because a caller keys an effect on this list: a region pinned to its
  // own countries would otherwise hand out a fresh array every render, and the
  // request that depends on it would fire in a loop.
  //
  // The preference itself is a single list across regions, as on the web, so it is
  // fetched once and not per region.
  const countries = useMemo(
    () => (filterable ? stored : regionCountryCodes(regionId)),
    [filterable, stored, regionId],
  );

  return { countries, error };
}
