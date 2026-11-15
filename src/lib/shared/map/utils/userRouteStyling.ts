import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { ResolvedTheme } from "../../theme/types";
import { lineClassColorExpression } from "../layers";
import { NO_RIDES, type RouteRides } from "../routeRides";
import { OPACITIES, routeColors, WIDTHS } from "../style";

/**
 * A route line's opacity: `open` for a running line, faded for a closed one
 * (OPACITIES.closedRoute). One condition, so no `all` (see below).
 */
export function closedRouteOpacityExpression(open: number): ExpressionSpecification {
  return ["case", ["==", ["get", "closed"], true], OPACITIES.closedRoute, open];
}

/**
 * The user map's route colour: visit status × line class. Each status (ridden
 * whole, ridden in part, not ridden) has three shades: light (branch), medium
 * (main), dark (highspeed).
 *
 * The status is the map owner's rides, matched by feature id (`routeRides.ts`):
 * the tile is the same for everyone and says nothing of who rode what. With no
 * rides it is the unridden colour throughout.
 *
 * **A `match`, and deliberately no `["all", ...]`.** MapLibre Native's React
 * binding throws `std::bad_alloc` converting a `case` that carries an `all`
 * condition alongside a further branch, which killed the Phase 0 mobile spike on
 * launch with no JS error and no crash report (see MOBILE_APP_PLAN.md, "The colour
 * expression"). A `match` with a list of labels per branch is a shape both
 * renderers take, and a hash lookup however long the lists are.
 *
 * The colours follow the scheme (`routeColors`); the logic doesn't.
 */
export function getUserRouteColorExpression(
  theme: ResolvedTheme,
  rides: RouteRides = NO_RIDES,
): ExpressionSpecification {
  const colors = routeColors(theme);
  const unridden = lineClassColorExpression(colors.unvisited);
  // A match may not have a branch with no labels, so an empty list is left out
  const branches: unknown[] = [];
  if (rides.whole.length > 0) {
    branches.push([...rides.whole], lineClassColorExpression(colors.visited));
  }
  if (rides.partial.length > 0) {
    branches.push([...rides.partial], lineClassColorExpression(colors.partial));
  }
  if (branches.length === 0) return unridden;
  return ["match", ["id"], ...branches, unridden] as ExpressionSpecification;
}

/**
 * The user map's draw order: ridden routes over unridden ones, so a ride stays
 * visible where lines run side by side or cross (most of all zoomed out). A
 * `line-sort-key`, which orders the features within a tile; a constant 0 with no
 * rides. The tile is drawn in `track_id` order otherwise.
 */
export function getUserRouteSortKeyExpression(
  rides: RouteRides = NO_RIDES,
): ExpressionSpecification | number {
  if (rides.ridden.length === 0) return 0;
  return ["match", ["id"], [...rides.ridden], 1, 0] as ExpressionSpecification;
}

type WidthStop = { branch: number; main: number; highspeed: number };

/**
 * Per-route width chooser given a target stop. Special-usage routes (any
 * non-regular usage_type: Heritage or Special) are rendered slightly thinner
 * than branch via WIDTHS.specialUsageMultiplier.
 */
function widthByClass(stop: WidthStop): ExpressionSpecification {
  return [
    "case",
    ["!=", ["get", "usage_type"], 0],
    stop.branch * WIDTHS.specialUsageMultiplier,
    ["==", ["get", "line_class"], "branch"],
    stop.branch,
    ["==", ["get", "line_class"], "highspeed"],
    stop.highspeed,
    stop.main,
  ] as ExpressionSpecification;
}

/**
 * Width expression for user railway routes. Single top-level zoom interpolate
 * (MapLibre only allows one zoom expression per property). All line classes
 * are visible at every zoom; widths just shrink when zoomed out.
 */
export function getUserRouteWidthExpression(): ExpressionSpecification {
  const s = WIDTHS.userRoute;
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    4,
    widthByClass(s.z4),
    7,
    widthByClass(s.z7),
  ] as ExpressionSpecification;
}

/**
 * Width expression for the dotted Heritage layer. Heritage dots are rendered via
 * a round line-cap, so their diameter equals the line width — they're scaled by
 * WIDTHS.heritageDotMultiplier off the branch width. The heritage layer only
 * contains heritage routes, so a single branch-based width per zoom is enough
 * (no line_class branching).
 */
export function getUserRouteHeritageWidthExpression(): ExpressionSpecification {
  const s = WIDTHS.userRoute;
  const dotWidth = (stop: WidthStop) => stop.branch * WIDTHS.heritageDotMultiplier;
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    4,
    dotWidth(s.z4),
    7,
    dotWidth(s.z7),
  ] as ExpressionSpecification;
}

/**
 * Wide transparent line used purely as a click/hover hit area so the visible
 * railway line can stay thin without becoming hard to tap on touch devices.
 */
export function getUserRouteClickBufferWidthExpression(): ExpressionSpecification {
  const s = WIDTHS.clickBuffer;
  return ["interpolate", ["linear"], ["zoom"], 4, s.z4, 12, s.z12];
}

/**
 * Wraps a width in the admin map's selected-route override: the selected
 * track_id renders at WIDTHS.selectedRoute, everything else at `normal`.
 */
function withAdminSelection(
  normal: ExpressionSpecification | number,
  selectedTrackId: number | null,
): ExpressionSpecification | number {
  if (selectedTrackId === null) return normal;
  return [
    "case",
    ["==", ["id"], selectedTrackId],
    WIDTHS.selectedRoute,
    normal,
  ] as ExpressionSpecification;
}

/**
 * Admin map width expression with selected-route override. Equivalent to
 * getUserRouteWidthExpression() but constant across zoom — the admin map shows
 * all line classes at the same width at every zoom, so no zoom interpolate is
 * needed at all.
 */
export function getAdminRouteWidthExpression(
  selectedTrackId: number | null,
): ExpressionSpecification | number {
  return withAdminSelection(widthByClass(WIDTHS.adminRoute), selectedTrackId);
}

/**
 * Admin-map width for the dotted Heritage layer. Like getAdminRouteWidthExpression
 * (constant across zoom, selected track rendered at WIDTHS.selectedRoute) but the
 * non-selected width is the heritage-dot width.
 */
export function getAdminRouteHeritageWidthExpression(
  selectedTrackId: number | null,
): ExpressionSpecification | number {
  return withAdminSelection(
    WIDTHS.adminRoute.branch * WIDTHS.heritageDotMultiplier,
    selectedTrackId,
  );
}
