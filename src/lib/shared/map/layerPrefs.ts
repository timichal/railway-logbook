/**
 * The user map's layer switches — what they are, how they are stored, and
 * what they read as in a region. Shared, so the web app (localStorage) and the
 * native app (AsyncStorage) keep one stored form and resolve it the same way; each
 * only does its own reading and writing of the string.
 *
 * **The Special switch is stored per region**, because its default is: a region
 * that counts Special as ordinary service (`ordinaryUsageTypes` — Japan's non-JR
 * lines) draws it from the outset, one that doesn't (Europe's diversions and
 * festival runs) keeps it hidden until asked. One region's choice says nothing
 * about the other's — turning Japan's non-JR lines off must not hide them in
 * Europe or the other way round. The heritage and scenic switches mean the same
 * thing everywhere and stay one value each.
 *
 * **The Regular switch exists only where Regular is not the only ordinary type**
 * (`hasOrdinaryNonRegular` — Japan's JR lines beside its non-JR ones), and is
 * stored per region for the same reason as Special. There the two are a filter in
 * the Map & Stats tab, as Europe's countries are: an unticked type is hidden on the
 * map and left out of the progress box. Elsewhere Regular is the map itself, there
 * is nothing to switch it with, and it always reads as shown.
 */

import type { UsageType } from "../constants";
import { hasOrdinaryNonRegular, isOrdinaryUsage, isRegionId, type RegionId } from "../regions";

export interface LayerPrefs {
  /** "JR lines" — Regular routes (usage_type=0, solid), switchable only in Japan. */
  showRegular: boolean;
  /** "Show heritage & tourist lines" — reveals Heritage routes (usage_type=1, dotted). */
  showHeritage: boolean;
  /** "Show special services" / "Non-JR lines" — Special routes (usage_type=2, dashed). */
  showSpecial: boolean;
  /** "Scenic lines" — the violet band under the admin-drawn scenic stretches. */
  showScenicLines: boolean;
}

/** The stored form: anything left out is at its default. */
export interface StoredLayerPrefs {
  showHeritage?: boolean;
  showScenicLines?: boolean;
  showSpecialByRegion?: Partial<Record<RegionId, boolean>>;
  showRegularByRegion?: Partial<Record<RegionId, boolean>>;
}

/** The switches kept per region rather than once for every region. */
const PER_REGION_KEY = {
  showRegular: "showRegularByRegion",
  showSpecial: "showSpecialByRegion",
} as const satisfies Partial<Record<keyof LayerPrefs, keyof StoredLayerPrefs>>;

/**
 * The usage types a region has a switch for: Heritage and Special everywhere,
 * Regular only where it is not the only ordinary type — elsewhere it is the map
 * itself. Where a switch is shown and whether a stored value is honoured both
 * follow this, so a region can't offer a switch its map ignores.
 */
export function switchableUsageTypes(regionId: RegionId): UsageType[] {
  return hasOrdinaryNonRegular(regionId) ? [0, 1, 2] : [1, 2];
}

/** The switch that shows or hides a usage type's routes. */
export function usageTypeLayerPref(usageType: UsageType): keyof LayerPrefs {
  if (usageType === 0) return "showRegular";
  if (usageType === 1) return "showHeritage";
  return "showSpecial";
}

/**
 * The stored JSON, tolerant of anything: a missing or unreadable value is the
 * defaults, and the forms written before are carried over —
 * - `showSpecial` (one value for every region) was only ever chosen against
 *   Europe's map, where Special was the only kind there was; it is kept for
 *   Europe and Japan starts at its own default.
 * - `showSpecialLines`, the web's single toggle for Heritage and Special together.
 * - `showScenicOutline`, the scenic switch from when scenic was a flag on routes.
 */
export function parseStoredLayerPrefs(json: string | null): StoredLayerPrefs {
  if (!json) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const raw = parsed as Record<string, unknown>;
  const bool = (value: unknown): boolean | undefined =>
    typeof value === "boolean" ? value : undefined;

  const legacyBoth = bool(raw.showSpecialLines);

  const byRegion = (value: unknown): Partial<Record<RegionId, boolean>> => {
    const values: Partial<Record<RegionId, boolean>> = {};
    if (typeof value === "object" && value !== null) {
      for (const [id, shown] of Object.entries(value)) {
        if (isRegionId(id) && typeof shown === "boolean") values[id] = shown;
      }
    }
    return values;
  };

  const showSpecialByRegion = byRegion(raw.showSpecialByRegion);
  const legacySpecial = bool(raw.showSpecial) ?? legacyBoth;
  if (legacySpecial !== undefined) showSpecialByRegion.europe ??= legacySpecial;

  return {
    showHeritage: bool(raw.showHeritage) ?? legacyBoth,
    showScenicLines: bool(raw.showScenicLines) ?? bool(raw.showScenicOutline),
    showSpecialByRegion,
    showRegularByRegion: byRegion(raw.showRegularByRegion),
  };
}

/** The switches as they stand in a region: stored where chosen, default otherwise. */
export function resolveLayerPrefs(stored: StoredLayerPrefs, regionId: RegionId): LayerPrefs {
  return {
    showRegular:
      !switchableUsageTypes(regionId).includes(0) ||
      (stored.showRegularByRegion?.[regionId] ?? true),
    showHeritage: stored.showHeritage ?? false,
    showSpecial: stored.showSpecialByRegion?.[regionId] ?? isOrdinaryUsage(regionId, 2),
    showScenicLines: stored.showScenicLines ?? false,
  };
}

/** The stored form with one switch set, as chosen in a region. */
export function withLayerPref(
  stored: StoredLayerPrefs,
  regionId: RegionId,
  key: keyof LayerPrefs,
  value: boolean,
): StoredLayerPrefs {
  if (key === "showRegular" || key === "showSpecial") {
    const storedKey = PER_REGION_KEY[key];
    return { ...stored, [storedKey]: { ...stored[storedKey], [regionId]: value } };
  }
  return { ...stored, [key]: value };
}
