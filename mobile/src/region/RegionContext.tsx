/**
 * Which of the two networks the app is looking at.
 *
 * A region is a bounding box (`@shared/regions`), and on the web it lives in a
 * cookie so the server components can read it. There is no cookie here and nothing
 * is server-rendered, so it lives in `AsyncStorage` — not SecureStore, which is for
 * credentials — and is hydrated before the first screen renders. `RegionId` is a
 * required parameter on every region-scoped endpoint and never defaults (`API.md`),
 * so a screen must not be able to observe "no region yet".
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { REGIONS, type Region, type RegionId } from "@shared/regions";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "railwayLogbook.region";
const DEFAULT_REGION: RegionId = "europe";

interface RegionValue {
  region: Region;
  regionId: RegionId;
  setRegion(id: RegionId): void;
}

const RegionContext = createContext<RegionValue | null>(null);

function isRegionId(value: string | null): value is RegionId {
  return value !== null && value in REGIONS;
}

export function RegionProvider({ children }: { children: ReactNode }): ReactNode {
  const [regionId, setRegionId] = useState<RegionId>(DEFAULT_REGION);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (isRegionId(stored)) setRegionId(stored);
      })
      .catch(() => {
        // A read failure just means the default region; nothing here is worth an
        // error screen.
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setRegion = useCallback((id: RegionId) => {
    setRegionId(id);
    void AsyncStorage.setItem(STORAGE_KEY, id);
  }, []);

  // Nothing renders against the default region and then jumps to the stored one:
  // from Phase 3 that jump is a map rebuild, and here it would be a wrong first
  // paint of the progress numbers.
  if (!hydrated) return null;

  return (
    <RegionContext.Provider value={{ region: REGIONS[regionId], regionId, setRegion }}>
      {children}
    </RegionContext.Provider>
  );
}

export function useRegion(): RegionValue {
  const value = useContext(RegionContext);
  if (!value) throw new Error("useRegion must be used inside RegionProvider");
  return value;
}
