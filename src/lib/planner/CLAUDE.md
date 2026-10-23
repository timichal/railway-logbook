# Journey planner

`src/lib/routePathFinder.ts` is the flow and the reads. This folder holds the network model (`routeGraph.ts`, pure) and its cache (`routeGraphCache.ts`), the search (`routeSearch.ts`, pure), each station's routes (`stations.ts`) and the travelled stretches (`routeVisits.ts`, pure). The modules carry the reasoning behind each invariant below. `npm run inspectPath` runs it from the CLI, and `tests/` covers the search and trims (networks built with `buildRouteGraph`).

The planner searches over **whole routes**, not OSM parts. Nodes are `(track_id, exit endpoint)`, and edges join endpoints within `ENDPOINT_TOLERANCE_METERS` (500m). Dijkstra, with cost = `length_km × line_class multiplier` (highspeed 0.5, main 1.0, branch 2.0) + gap penalty. It rides Regular routes, plus the region's ordinary non-Regular ones when `PlannerOptions.includeSpecial` asks (`ordinaryRouteSql`, `plannerRouteSql`). The server only ever adds types the region counts.

- State includes the exit endpoint, so a route is entered at one end and left at the other. The entry side is the **nearer** endpoint, not the first one within tolerance.
- The terminal routes are costed for the stretch travelled, from `ST_LineLocatePoint` fractions. So the search keeps the cheapest finish and runs until nothing queued can beat it. An end route is never travelled through.
- `GAP_PENALTY_PER_KM` (25) charges the gap at each connection, so the search can't skip a junction complex's short connectors. `inspectPath` prints the gaps: tens of metres is normal, hundreds means something was skipped.
- The whole network is loaded at once (endpoints only) into a spatial grid. The built graph is cached, keyed on a `count(*)`/`sum(xmin)` fingerprint of `railway_routes`, not on `updated_at`.
- Station → routes is one indexed query with progressive tolerance (100m → 5km) in memory.
- Every route is trimmed to the stretch travelled (`planVisits` → `planTrims` → `cutTravelledStretches`), getting `partial` + `travelled_length_km`. The endpoints travelled come from the search (`SearchResult.sides`) and are never inferred. A route visited twice, or left with under `MIN_UNTRAVELLED_KM` (0.3km) untravelled, stays whole. One barely touched (a stop within 0.3km of its endpoint) is dropped. A plan with no route left is refused.
- A segment after a via is seeded from every route serving the via. Changing lines there costs the gap between the lines at the station (× `GAP_PENALTY_PER_KM`) plus `VIA_CHANGE_PENALTY` (5): `changeCosts`.
- A route the plan only partly covers arrives in the Route Logger with `partial` ticked and its stretch attached.
