/**
 * The two regions, trimmed to what a map needs. From `src/lib/regions.ts`.
 *
 * The plan asks Phase 0 to "confirm that the tile volumes behave for both", so
 * the spike carries both and lets you switch.
 */
export type RegionId = "europe" | "japan";

export interface SpikeRegion {
  id: RegionId;
  label: string;
  center: [number, number];
  zoom: number;
  /** [[west, south], [east, north]] — MapLibre maxBounds. */
  bounds: [[number, number], [number, number]];
}

export const REGIONS: Record<RegionId, SpikeRegion> = {
  europe: {
    id: "europe",
    label: "Europe",
    center: [14.5, 49.2],
    zoom: 7,
    bounds: [
      [-12, 35],
      [40, 71],
    ],
  },
  japan: {
    id: "japan",
    label: "Japan",
    center: [138.2, 36.5],
    zoom: 6,
    bounds: [
      [122, 24],
      [149, 46.5],
    ],
  },
};
