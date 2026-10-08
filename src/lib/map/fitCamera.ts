import type {
  CameraOptions,
  LngLatBoundsLike,
  Map as MapLibreMap,
  PaddingOptions,
} from "maplibre-gl";
import type { RouteBounds } from "@/lib/shared/types";

/**
 * Fitting the camera to some routes — an opened journey, trip or plan, or a line
 * picked in the search box: the margin left around them, on top of the camera
 * padding the mobile sheet already holds, and how far in it may go — a single short
 * route would otherwise fill the screen at street level.
 */
const FIT_PADDING_PX = { desktop: 64, mobile: 24 };
const FIT_MAX_ZOOM = 12;
/** How far a fitted route is kept from the edge of the progress box. */
const FIT_BOX_GAP_PX = 16;

/**
 * The paddings a fit may use to keep its routes out from under the progress box
 * (`data-progress-box`), which sits in a corner of the map on top of it. A corner
 * can be cleared from either of its two sides, so both are offered — widen the
 * bottom margin past the box's top edge, or the side margin past its inner edge —
 * and the caller takes whichever lets the routes fit closer. A box outside the
 * padded view (or none at all, as on the admin map) leaves the plain margin.
 */
function fitPaddings(m: MapLibreMap, margin: number): PaddingOptions[] {
  const all = { top: margin, right: margin, bottom: margin, left: margin };
  const box = m.getContainer().parentElement?.querySelector("[data-progress-box]");
  if (!box) return [all];
  const view = m.getContainer().getBoundingClientRect();
  const rect = box.getBoundingClientRect();
  const camera = m.getPadding();
  const onRight = rect.left + rect.width / 2 > view.left + view.width / 2;
  // How far the box reaches into the padded view from the bottom, and from its side
  const intoBottom = view.bottom - (camera.bottom ?? 0) - rect.top;
  const intoSide = onRight
    ? view.right - (camera.right ?? 0) - rect.left
    : rect.right - (view.left + (camera.left ?? 0));
  if (intoBottom <= 0 || intoSide <= 0) return [all];
  return [
    { ...all, bottom: Math.max(margin, intoBottom + FIT_BOX_GAP_PX) },
    { ...all, [onRight ? "right" : "left"]: Math.max(margin, intoSide + FIT_BOX_GAP_PX) },
  ];
}

/**
 * The camera that shows `box`: clear of the progress box if there is room, by
 * whichever side zooms in further. With the mobile sheet pulled up, the strip of map
 * left may have no room for that, for the margin, or for the routes at any zoom;
 * cameraForBounds then gives up, and the routes are still centred in that strip
 * rather than left off screen.
 */
export function fitCamera(m: MapLibreMap, box: RouteBounds, isMobile: boolean): CameraOptions {
  const [west, south, east, north] = box;
  const bounds: LngLatBoundsLike = [
    [west, south],
    [east, north],
  ];
  const padding = isMobile ? FIT_PADDING_PX.mobile : FIT_PADDING_PX.desktop;
  const clearOfBox = fitPaddings(m, padding)
    .map((p) => m.cameraForBounds(bounds, { padding: p, maxZoom: FIT_MAX_ZOOM }))
    .reduce((best, c) => (c && (!best || (c.zoom ?? 0) > (best.zoom ?? 0)) ? c : best));
  return (
    clearOfBox ??
    m.cameraForBounds(bounds, { padding, maxZoom: FIT_MAX_ZOOM }) ??
    m.cameraForBounds(bounds, { maxZoom: FIT_MAX_ZOOM }) ?? {
      center: [(west + east) / 2, (south + north) / 2],
    }
  );
}
