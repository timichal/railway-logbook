"use client";

/**
 * The region the whole page is looking at (see src/lib/regions.ts).
 *
 * A context rather than props: the region reaches the map, the sidebar tabs, the
 * journey planner and the admin lists alike, and threading it through every
 * layer in between would touch components that have no other interest in it.
 *
 * The selection lives in a cookie, so the server components render the right
 * region on the first paint instead of flashing Europe and then correcting
 * itself. React state holds the live value; the cookie is only ever written.
 */

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { DEFAULT_REGION, REGION_COOKIE, REGIONS, type Region, type RegionId } from "./regions";

interface RegionContextValue {
  region: Region;
  regionId: RegionId;
  setRegion: (regionId: RegionId) => void;
}

const RegionContext = createContext<RegionContextValue | null>(null);

/** A year, so the choice survives; `lax` because nothing here is cross-site. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function RegionProvider({
  initialRegion,
  children,
}: {
  initialRegion: RegionId;
  children: ReactNode;
}) {
  const [regionId, setRegionId] = useState<RegionId>(initialRegion);

  const setRegion = useCallback((next: RegionId) => {
    setRegionId(next);
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is still missing from Safari, and this writes one small cookie with no reads to race against.
    document.cookie = `${REGION_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
  }, []);

  const value = useMemo(
    () => ({ region: REGIONS[regionId], regionId, setRegion }),
    [regionId, setRegion],
  );

  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
}

/**
 * The full region context. Outside a provider it reports the default region and
 * a no-op setter, so a component can be rendered in isolation without crashing.
 */
export function useRegionContext(): RegionContextValue {
  const value = useContext(RegionContext);
  if (value) return value;
  return { region: REGIONS[DEFAULT_REGION], regionId: DEFAULT_REGION, setRegion: () => {} };
}

/** The current region id — the form every region-scoped server action takes. */
export function useRegionId(): RegionId {
  return useRegionContext().regionId;
}

/** The current region's full definition (label, bounds, countries). */
export function useRegion(): Region {
  return useRegionContext().region;
}
