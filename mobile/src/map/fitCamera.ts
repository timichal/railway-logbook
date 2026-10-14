/**
 * Fitting the camera to some routes — an opened journey or trip, or a plan — as
 * `fitCamera.ts` does on the web.
 *
 * Worked out here rather than handed to the binding as a bounds stop. A bounds stop
 * takes no `maxZoom`, so a single short route would fill the screen at street level;
 * and on Android the padding a stop carries stays on as the camera's own, which
 * shifts the centre `onRegionDidChange` reports and the map saves. So the centre and
 * zoom are found in Web Mercator against the map's own size, the padding is spent in
 * the arithmetic, and the stop is a plain centre and zoom.
 */
import { FIT_MAX_ZOOM } from "@shared/map/zoomRanges";
import type { RouteBounds } from "@shared/types";

/** MapLibre's world is 512 points across at zoom 0, natively as in the browser. */
const TILE_SIZE = 512;

export interface FitPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A position as a fraction of the world, 0–1 from the top-left. */
function mercatorX(lng: number): number {
  return (lng + 180) / 360;
}

function mercatorY(lat: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

function latitudeAt(y: number): number {
  return (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;
}

/**
 * The centre and zoom that show `box` inside the part of a `width` × `height` map
 * left by `padding`, zoomed in no further than `FIT_MAX_ZOOM` (the web's) nor out past
 * `minZoom`. A padding that leaves no room (a very small map) is dropped rather than
 * allowed to turn the zoom negative.
 */
export function fitCamera(
  box: RouteBounds,
  size: { width: number; height: number },
  padding: FitPadding,
  minZoom: number,
): { center: [number, number]; zoom: number } {
  const [west, south, east, north] = box;
  const x0 = mercatorX(west);
  const x1 = mercatorX(east);
  const y0 = mercatorY(north);
  const y1 = mercatorY(south);

  const roomy =
    size.width - padding.left - padding.right > 0 && size.height - padding.top - padding.bottom > 0;
  const pad = roomy ? padding : { top: 0, right: 0, bottom: 0, left: 0 };
  const width = size.width - pad.left - pad.right;
  const height = size.height - pad.top - pad.bottom;

  // A box of no extent (one point) divides to Infinity, which the cap catches
  const scale = Math.min(width / ((x1 - x0) * TILE_SIZE), height / ((y1 - y0) * TILE_SIZE));
  const zoom = Math.max(minZoom, Math.min(FIT_MAX_ZOOM, Math.log2(scale)));

  // The box is centred in the padded part of the map, which sits off the map's
  // centre by half the difference between opposite paddings
  const worldSize = TILE_SIZE * 2 ** zoom;
  const x = (x0 + x1) / 2 - (pad.left - pad.right) / 2 / worldSize;
  const y = (y0 + y1) / 2 - (pad.top - pad.bottom) / 2 / worldSize;

  return { center: [x * 360 - 180, latitudeAt(y)], zoom };
}
