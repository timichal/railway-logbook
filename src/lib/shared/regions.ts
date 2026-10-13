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
 * country (`hasCountryFilter: false`) hide the country list and simply pass
 * their own country list.
 */

import {
  getUsageLabel,
  getUsagePluralLabel,
  SUPPORTED_COUNTRIES,
  type UsageType,
  usageOptions,
} from "./constants";

export type RegionId = "europe" | "japan";

/** [[west, south], [east, north]] */
type RegionBounds = [[number, number], [number, number]];

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
   * single-country region, where the country list is hidden and the country
   * filter is pinned to the region's own list.
   */
  hasCountryFilter: boolean;
  /**
   * Whether every route here carries a line name of its own, alongside its two
   * endpoints. Japan's network is named line by line ("Chuo Main Line"), and the
   * name is what identifies a route there — so the admin forms require it, the
   * routes list can filter for the ones still missing it, and the hover popups
   * lead with it. Europe names nothing: a route is its endpoints, and the field
   * is not even shown.
   */
  hasRouteNames: boolean;
  /**
   * Whether the "Scenic lines" toggle is offered on the user map. Scenic lines
   * (`scenic_lines`) are stored region-agnostically; this decides whether the
   * region's map offers to show them, and whether its admin page offers the
   * Scenic tab to draw them — nothing drawn there would ever be shown.
   */
  hasScenicHighlight: boolean;
  /**
   * The usage types that are ordinary timetabled service here — what progress
   * counts, what the planner may ride, and what the map draws without being asked.
   * Regular everywhere. In Europe a Special route is national track used
   * irregularly — a diversion, a festival run — which nobody can plan a journey
   * over or be expected to have ridden. In Japan Special is the non-JR operators'
   * lines, timetabled like any other, so it counts: the progress total takes both,
   * the statistics give each its own row, the planner offers them behind a switch
   * that starts on, and their map layer starts shown (`map/layerPrefs.ts`).
   * Heritage is never ordinary — a line of its own, outside the timetable.
   */
  ordinaryUsageTypes: readonly UsageType[];
  /**
   * Usage types this region renames. The axis (whose track, whose timetable) is
   * the same everywhere, but Japan's split falls exactly on the JR / non-JR
   * operator line, which is what a Japanese reader recognises — so Regular reads
   * "JR line" and Special "Non-JR line" there, in the badges and the admin forms
   * alike. Types left out keep the default label from `usageOptions`.
   */
  usageLabels?: Partial<Record<UsageType, string>>;
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
    hasRouteNames: false,
    hasScenicHighlight: true,
    ordinaryUsageTypes: [0],
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
    hasRouteNames: true,
    hasScenicHighlight: false,
    ordinaryUsageTypes: [0, 2],
    usageLabels: { 0: "JR line", 2: "Non-JR line" },
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
  // hasOwn, not `in`: `in` walks the prototype chain, so "constructor" passed.
  return typeof value === "string" && Object.hasOwn(REGIONS, value);
}

/** A region id as given, falling back to the default for anything unknown. */
export function regionIdOrDefault(value: unknown): RegionId {
  return isRegionId(value) ? value : DEFAULT_REGION;
}

/**
 * A usage type's label as this region names it — the region's own wording where
 * it has one, the shared default otherwise. Every label shown to a user goes
 * through here; `getUsageLabel` in constants.ts is the region-less fallback.
 */
export function regionUsageLabel(regionId: RegionId, usageType: UsageType): string {
  return REGIONS[regionId].usageLabels?.[usageType] ?? getUsageLabel(usageType);
}

/**
 * A usage type as the map's layer switch names it — the plural of
 * `regionUsageLabel`, for the switch that shows or hides the whole set ("Non-JR
 * lines", "Special services").
 *
 * A region's `usageLabels` are singular by contract, so an override is pluralised
 * by appending "s"; only where a region says nothing does the default come from
 * `getUsagePluralLabel`, whose nouns differ per type and cannot be derived.
 */
export function regionUsagePluralLabel(regionId: RegionId, usageType: UsageType): string {
  const override = REGIONS[regionId].usageLabels?.[usageType];
  return override ? `${override}s` : getUsagePluralLabel(usageType);
}

/** `usageOptions` with this region's labels applied, for the admin route forms. */
export function regionUsageOptions(regionId: RegionId) {
  return usageOptions.map((option) => ({
    ...option,
    label: regionUsageLabel(regionId, option.id),
  }));
}

/** ISO country codes of a region, e.g. for the `selected_countries` tile filter. */
export function regionCountryCodes(regionId: RegionId): string[] {
  return REGIONS[regionId].countries.map((country) => country.code);
}

/**
 * The point columns a region is decided on: a route's or scenic line's start,
 * a station's position, a note's. Never a line — see `regionContainsSql`.
 */
type RegionPointColumn =
  | "starting_coordinate"
  | "rr.starting_coordinate"
  | "r.starting_coordinate"
  | "coordinates"
  | "coordinate";

/**
 * The one test of what belongs to a region, as a SQL condition: `point` lies in
 * the region's box.
 *
 *   WHERE ${regionContainsSql(region, "rr.starting_coordinate")}
 *
 * Always a **point**, which the column type holds callers to. `geometry && box`
 * reads the whole (TOASTed) line to get at its bbox, ~100ms over the route table,
 * to decide something the start point already decides for everything we draw:
 * Japan is an island chain, and Europe's box reaches well past the mainland we
 * route on. The OSM import does carry track beyond the box (European Russia
 * east of 40°E), but a route is only ever drawn inside it. The numbers come
 * from this module (never from user input), so interpolating them is safe.
 */
export function regionContainsSql(regionId: RegionId, point: RegionPointColumn): string {
  const [[west, south], [east, north]] = REGIONS[regionId].bounds;
  return `${point} && ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)`;
}

/** Whether a usage type is ordinary service in this region (`ordinaryUsageTypes`). */
export function isOrdinaryUsage(regionId: RegionId, usageType: UsageType): boolean {
  return REGIONS[regionId].ordinaryUsageTypes.includes(usageType);
}

/**
 * Whether a region counts more than Regular as ordinary — and so whether its
 * statistics break the total down by usage type, and its planner offers the
 * switch for the rest.
 */
export function hasOrdinaryNonRegular(regionId: RegionId): boolean {
  return REGIONS[regionId].ordinaryUsageTypes.length > 1;
}

/**
 * The usage types a region's progress counts: its ordinary ones, narrowed to
 * `shown` where given — the map's usage switches, so a type unticked in the
 * statistics leaves the progress box as it leaves the map, the way an unticked
 * country does. Anything in `shown` the region does not count is ignored, which
 * also keeps a list sent by a client from widening the count; anything but an
 * array counts every type. The result holds this module's numbers only, so it
 * may be interpolated into SQL.
 */
export function countedUsageTypes(regionId: RegionId, shown?: readonly unknown[]): UsageType[] {
  const ordinary = REGIONS[regionId].ordinaryUsageTypes;
  // Not trusted to be an array: a server action's arguments are whatever was posted
  return Array.isArray(shown) ? ordinary.filter((type) => shown.includes(type)) : [...ordinary];
}

/**
 * The SQL condition "`column` is a usage type this region counts", for a query
 * already scoped to the region — narrowed to `shown` as `countedUsageTypes` is.
 */
export function ordinaryUsageSql(
  regionId: RegionId,
  column: string,
  shown?: readonly unknown[],
): string {
  const counted = countedUsageTypes(regionId, shown);
  return counted.length > 0 ? `${column} IN (${counted.join(", ")})` : "FALSE";
}

/**
 * The SQL condition "route `alias` is ordinary service in whichever region it is
 * in", for the queries that are not region-scoped — the planner's network, which is
 * one graph over both regions. Regular anywhere; any other usage type only inside a
 * region that counts it, so a Special route in Europe never qualifies however the
 * caller asks.
 */
export function ordinaryRouteSql(alias: "r" | "rr"): string {
  const clauses = [`${alias}.usage_type = 0`];
  for (const id of REGION_IDS) {
    const others = REGIONS[id].ordinaryUsageTypes.filter((type) => type !== 0);
    if (others.length === 0) continue;
    clauses.push(
      `(${alias}.usage_type IN (${others.join(", ")}) AND ${regionContainsSql(id, `${alias}.starting_coordinate`)})`,
    );
  }
  return `(${clauses.join(" OR ")})`;
}

/**
 * Whether a region has a statistics view at all — the counted half of the web
 * sidebar's Map & Stats tab, the native app's Countries/Statistics screen: the
 * countries where it can filter by them, the per-line-type numbers where it counts
 * more than Regular. One test, so the row that opens the view and the view itself
 * cannot disagree.
 */
export function hasStatsView(regionId: RegionId): boolean {
  return REGIONS[regionId].hasCountryFilter || hasOrdinaryNonRegular(regionId);
}

/** The region whose box holds a [lng, lat] point, or null for one outside them all. */
export function regionOfPoint([lng, lat]: [number, number]): RegionId | null {
  return (
    REGION_IDS.find((id) => {
      const [[west, south], [east, north]] = REGIONS[id].bounds;
      return lng >= west && lng <= east && lat >= south && lat <= north;
    }) ?? null
  );
}
