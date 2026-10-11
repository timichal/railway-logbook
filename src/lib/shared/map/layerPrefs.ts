/**
 * The user map's three layer switches — what they are, how they are stored, and
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
 */

import { isOrdinaryUsage, isRegionId, type RegionId } from "../regions";

export interface LayerPrefs {
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

  const showSpecialByRegion: Partial<Record<RegionId, boolean>> = {};
  const legacySpecial = bool(raw.showSpecial) ?? legacyBoth;
  if (legacySpecial !== undefined) showSpecialByRegion.europe = legacySpecial;
  if (typeof raw.showSpecialByRegion === "object" && raw.showSpecialByRegion !== null) {
    for (const [id, value] of Object.entries(raw.showSpecialByRegion)) {
      if (isRegionId(id) && typeof value === "boolean") showSpecialByRegion[id] = value;
    }
  }

  return {
    showHeritage: bool(raw.showHeritage) ?? legacyBoth,
    showScenicLines: bool(raw.showScenicLines) ?? bool(raw.showScenicOutline),
    showSpecialByRegion,
  };
}

/** The switches as they stand in a region: stored where chosen, default otherwise. */
export function resolveLayerPrefs(stored: StoredLayerPrefs, regionId: RegionId): LayerPrefs {
  return {
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
  if (key === "showSpecial") {
    return { ...stored, showSpecialByRegion: { ...stored.showSpecialByRegion, [regionId]: value } };
  }
  return { ...stored, [key]: value };
}
