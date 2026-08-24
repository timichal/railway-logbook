/**
 * Map regions.
 *
 * The app covers two geographically disjoint networks — Europe and Japan — and
 * shows exactly one of them at a time. The backend is shared: one database, one
 * import pipeline, one set of tables. Japan is just more rows, the way another
 * country would be.
 *
 * A region is a **bounding box**, and everything region-scoped follows from it:
 * the map is locked to it (`bounds` is MapLibre's maxBounds), and every server
 * query that must not leak the other network filters on it. Coordinates rather
 * than country codes, because the two boxes are half a planet apart — no route,
 * station or note can be ambiguous — and because it needs no column to maintain
 * and no backfill when a route moves.
 *
 * The box is a *display and filter extent*, not a country test: it is drawn
 * generously around the network we map, so it also covers water and slivers of
 * neighbouring countries. That is harmless — we only ever import OSM extracts
 * for the regions themselves.
 *
 * The user map's route filtering is a separate mechanism that happens to line up:
 * routes carry `start_country`/`end_country`, and each region declares the
 * countries it contains, so the existing `selected_countries` tile filter already
 * keeps the regions apart (Japan view asks for `['JP']`). Regions with a single
 * country (`hasCountryFilter: false`) hide the Countries tab and simply pass
 * their own country list.
 */

import { SUPPORTED_COUNTRIES } from "./constants";

export type RegionId = "europe" | "japan";

/** [[west, south], [east, north]] */
export type RegionBounds = [[number, number], [number, number]];

export interface Region {
  id: RegionId;
  /** Shown on the region switch. */
  label: string;
  /** Flag emoji for the region switch. */
  flag: string;
  /** Initial map center, used when no saved map state exists for this region. */
  center: [number, number];
  /** Initial map zoom, used when no saved map state exists for this region. */
  zoom: number;
  /** Map panning limit and the extent every region-scoped query filters on. */
  bounds: RegionBounds;
  /** Countries whose routes belong to this region (ISO 3166-1 alpha-2). */
  countries: readonly { readonly code: string; readonly name: string }[];
  /**
   * Whether the user can filter this region by country. False for a
   * single-country region, where the Countries tab is hidden and the country
   * filter is pinned to the region's own list.
   */
  hasCountryFilter: boolean;
  /**
   * Frequency tag prefilled when a route in this region is marked Special.
   * We're using this tag for non-JR operators in Japan, so it's a default
   * rather than something to retype; it is a plain autofill, and the
   * admin can delete it in the tag input like any other.
   */
  specialUsageTag?: string;
}

export const REGIONS: Record<RegionId, Region> = {
  europe: {
    id: "europe",
    label: "Europe",
    flag: "🇪🇺",
    center: [14.5, 49.2], // Czech Republic/Austria border region
    zoom: 7,
    bounds: [
      [-12, 35], // Southwest corner (Portugal/Spain)
      [40, 71], // Northeast corner (Western Russia/Scandinavia)
    ],
    countries: SUPPORTED_COUNTRIES,
    hasCountryFilter: true,
  },
  japan: {
    id: "japan",
    label: "Japan",
    flag: "🇯🇵",
    center: [138.2, 36.5], // Central Honshu
    zoom: 6,
    bounds: [
      [122, 24], // Southwest corner (Yonaguni / south of Okinawa)
      [149, 46.5], // Northeast corner (east of Hokkaido)
    ],
    countries: [{ code: "JP", name: "Japan" }],
    hasCountryFilter: false,
    specialUsageTag: "Non-JR line",
  },
};

export const REGION_IDS = Object.keys(REGIONS) as RegionId[];

export const DEFAULT_REGION: RegionId = "europe";

/**
 * Cookie holding the selected region. A cookie rather than localStorage so the
 * server components can render the correct region on the first paint.
 */
export const REGION_COOKIE = "railway-region";

export function isRegionId(value: unknown): value is RegionId {
  return typeof value === "string" && value in REGIONS;
}

/** The region for an id, falling back to the default for anything unknown. */
export function getRegion(value: unknown): Region {
  return REGIONS[isRegionId(value) ? value : DEFAULT_REGION];
}

/** ISO country codes of a region, e.g. for the `selected_countries` tile filter. */
export function regionCountryCodes(regionId: RegionId): string[] {
  return REGIONS[regionId].countries.map((country) => country.code);
}

/** The region a coordinate falls in, or null if it is outside every region. */
export function regionForCoordinate(lon: number, lat: number): RegionId | null {
  for (const id of REGION_IDS) {
    const [[west, south], [east, north]] = REGIONS[id].bounds;
    if (lon >= west && lon <= east && lat >= south && lat <= north) return id;
  }
  return null;
}

/**
 * A PostGIS envelope literal for a region, for use in SQL as a bbox filter:
 *
 *   WHERE rr.geometry && ${regionEnvelopeSql(region)}
 *
 * The `&&` bbox operator is GIST-index-backed, and the regions are far enough
 * apart that a bbox overlap is as good as a containment test. The numbers come
 * from this module (never from user input), so interpolating them is safe.
 */
export function regionEnvelopeSql(regionId: RegionId): string {
  const [[west, south], [east, north]] = REGIONS[regionId].bounds;
  return `ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)`;
}
