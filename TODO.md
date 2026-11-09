# TODO

- **Remove the pathfinder-change worklist** once the admin's "Recalculated" chip (routes and scenic lines) counts 0 on the server: delete `src/lib/pathfinderChange.ts`, `src/scripts/flagPathfinderChanges.ts`, its `package.json` entry and root CLAUDE.md line, and the `pathfinderChange` filter in `AdminRoutesTab.tsx` and `AdminScenicLinesTab.tsx`.
- **Split route 1643 Szczecin → Szczecin [junction]**: it is a loop with both sides used, stored as the 9.2 km side; the distance search takes the 6.6 km side, so the flag script will list it.
- **Pathfinder, if a route's reversal ever goes missing** (deferred from the review of the distance search, `railwayPathFinder.ts` `findPath`):
  - A path without backtracking wins **however much longer** it is, so a real reversal (a train turning back at a station) loses to any loop in the buffer that avoids it, and re-picking shows the same detour. If that bites, cap the alternative (e.g. +50% or +20km, whichever is larger; the cases that needed it were +5%/+8.4km Olsztyn–Ełk and +16%/+3km Urakami–Kikitsu), or honour `intended_backtracking`.
  - When the search without backtracking finds a walk that passes a part twice (round a balloon loop), `findPath` falls back to the backtracking path without trying a longer simple one.
  - Between click-point combinations (a click on a node matched to several parts), a shorter backtracking path still beats a clean one unless within 10m (`findBestCoordinatePath`), unlike the rule within one combination.
