/**
 * Where each region was last looked at, as `mapState.ts` keeps it on the web.
 *
 * One saved position **per region**: they are half a planet apart, so restoring
 * Europe's centre into the Japan view would land outside that region's bounds.
 * Switching regions therefore returns you to where you left that one.
 *
 * Reads are async (`AsyncStorage`), and the camera has to be positioned at
 * construction — `initialViewState` is applied once and cannot be revisited (see
 * MOBILE_APP_PLAN.md) — so `RailwayMap` waits for the read before it mounts the map,
 * exactly as it waits for the basemap style.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RegionId } from "@shared/regions";

export interface MapPosition {
  center: [number, number];
  zoom: number;
}

const key = (region: RegionId) => `railwayLogbook.mapPosition.${region}`;

function isPosition(value: unknown): value is MapPosition {
  if (!value || typeof value !== "object") return false;
  const { center, zoom } = value as Partial<MapPosition>;
  return (
    Array.isArray(center) &&
    center.length === 2 &&
    typeof center[0] === "number" &&
    typeof center[1] === "number" &&
    typeof zoom === "number"
  );
}

export async function loadMapPosition(region: RegionId): Promise<MapPosition | null> {
  try {
    const stored = await AsyncStorage.getItem(key(region));
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    return isPosition(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveMapPosition(region: RegionId, position: MapPosition): void {
  void AsyncStorage.setItem(key(region), JSON.stringify(position)).catch(() => {
    // A map that forgets where it was is a small loss; nothing to report.
  });
}
