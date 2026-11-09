# Pathfinder caveats

Known limits of the route pathfinder (`src/scripts/lib/railwayPathFinder.ts`), none of which any valid route runs into today. Nothing here is to be done unless a real route needs it; each entry says what would show it and what to do then.

## A reversal can lose to any detour

A path without backtracking wins **however much longer** it is (`findPath`). So a real reversal, a train turning back at a station, loses to any loop within the search buffer that avoids it, and re-picking shows the same detour. Only 3 valid routes are marked `intended_backtracking`, and all still reverse.

**If one turns up:** cap the alternative, e.g. at +50% or +20km, whichever is larger. The cases that needed the alternative were +5% / +8.4km (Olsztyn–Ełk) and +16% / +3km (Urakami–Kikitsu). Or honour `intended_backtracking`.

## Related backtracking limits

- When the search without backtracking finds a walk that passes a part twice (round a balloon loop), `findPath` falls back to the backtracking path without trying a longer simple one.
- Between click-point combinations (a click on a node matched to several parts), a shorter backtracking path still beats a clean one unless within 10m (`findBestCoordinatePath`), unlike the rule within one combination.

## New routes that should lie on other routes' track

A _new_ route's preview keeps off every other route's track (`avoidOtherRoutes`, ×1.5, so up to 50% longer). A Special route drawn over regular track (a diversion, a tourist run) or a tram-train therefore can't be drawn on it. Re-picks and recalculation are fine, since a route's own track never counts against it.

**If one turns up:** a "Keep off other routes' track" checkbox in the New Route tab, on by default, passed through `AdminPathFor`. Limiting the penalty to routes of the same usage type would not do: 5682 (Abukuma Express, Special) must keep off 5684 (Tōhoku Main Line, Regular).
