# Route recalculation performance

Read this before changing `verifyRouteData.ts` or `scripts/lib/railwayPathFinder.ts`
for performance reasons. The work described here is **done**; what remains is the
reasoning behind the current shape, the constraints that must not be broken, and
the two things still on the table.

## Why this step matters

`npm run importMapData` has three steps. Step 1 (loading stations and parts) is
I/O over a few gigabytes and finishes in minutes. Step 3 (station proximity) is a
single query. **Step 2 — recalculating every route against the new OSM data — is
where the import spends most of its wall-clock**, and it is the reason a deploy
takes as long as it does.

It is also, structurally, the easiest part of the pipeline to make fast: every
route is recalculated independently of every other one.

## What it does now

`recalculateAllRoutes` runs a fixed set of workers over the route list, each
pulling the next route off a shared index and writing its own `UPDATE`:

- **`DEFAULT_RECALC_CONCURRENCY` = 4 routes at a time.** This needs a `Pool`, not
  a `Client`: node-pg serialises concurrent queries on a single connection, so
  workers sharing one would just queue behind each other. Both scripts build the
  pool with `createRecalcPool(concurrency)`, and `--concurrency=N` overrides the
  default (`importMapData`, `verifyRouteData`, and `deploy.sh`, which forwards it
  to the remote import).
- **The `UPDATE`s stay autocommitted, one per route.** Do not wrap the run in a
  transaction: it would hold row locks on `railway_routes` for the length of the
  import.
- **Outcomes are collected by index**, then aggregated in a second pass, so the
  summary lists routes in `track_id` order however the workers interleave.
- **A thrown error stops the run.** Pathfinding failure is already an outcome
  (`recalculateRoute` catches it and returns `{success: false}`), so an exception
  escaping `recalculateAndStoreRoute` means the database is unhappy — the worker
  sets `aborted`, the others stop taking new routes, and it propagates. Marking a
  route invalid over a transient fault would be worse than failing loudly.
- **`RailwayPathFinder` takes `{quiet: true}`** instead of having its output
  silenced from outside. The old code swapped out the global `console.log` around
  each search and restored it in a `finally`; that is safe only while calls are
  strictly serial. With two in flight the first to finish un-silences the rest,
  and a call that starts while the patch is in place captures the no-op as its
  "original" and silences logging permanently. `mergeLinearChain` takes the same
  logger for the same reason — it was previously silenced by that global patch as
  a side effect, and would otherwise bury the progress line.
- **The route list query selects only what recalculation reads.** It used to
  fetch `starting_part_id`, `ending_part_id` and `ST_AsGeoJSON(geometry)`, none
  of which anything read — the geometry is replaced wholesale. That was ~16 MB of
  GeoJSON text for 1744 routes (~50 MB for a full run) serialised, shipped and
  held in Node for nothing.
- **One query loads both endpoints' surroundings**
  (`loadRailwayPartsAroundCoordinates`), against the GIST-indexed
  `railway_parts.geometry_3857` with `ST_DWithin`. It used to be two queries, one
  per endpoint, each materialising an `ST_Buffer` 32-gon and testing
  `ST_Intersects` against the WGS84 column. For any route shorter than the buffer
  — most of them — the two disks overlap almost entirely, so every part in the
  overlap was selected, encoded as GeoJSON, shipped and `JSON.parse`d twice, only
  for `parseAndStoreParts` to drop the second copy.
- **`loadRailwayParts`, the part-id-based loader, is gone.** Nothing called it,
  and it was the last carrier of the superseded `ST_Buffer` pattern. If part-id
  loading is ever wanted again, build it on `ST_DWithin` against `geometry_3857`
  like its coordinate-based sibling.

Measured on a 16-core dev box against a Dockerised Postgres holding 1.44M
railway parts, over a sample of 200 valid routes spread across the whole set
(the first N by `track_id` all sit in one country, and cost varies hugely with
network density):

| | ms/route |
|---|---|
| two buffered queries, serial (before) | 326 |
| one indexed query, serial | 242 |
| one indexed query, 2 workers | 170 |
| one indexed query, 4 workers | 157 |
| one indexed query, 8 workers | 155 |

**~2.1× overall at the default of 4.** Scaling flattens hard after 2 — the work
is a mix of Postgres-side spatial filtering and Node-side JSON parsing, and this
box saturates one of them early. Measure on the deploy host before raising the
default there; the ceiling is memory as much as CPU, since each worker holds its
own bufferful of parsed geometry (which is why `importMapData` runs with
`--max-old-space-size=8192`).

A full `verifyRouteData --valid-only` over 1744 valid routes takes about 5 min at
the default concurrency. Treat single-run timings as rough: repeated runs on the
same box varied by well over a minute.

## Do not shrink the buffer

Tempting, and wrong. The `[50000, 100000, 222000]` ladder in
`findPathFromCoordinates` only escalates when **no path is found**. A tighter
first pass that happens to find a *longer* path — because the true shortest one
left the loaded area — returns that longer path instead, which then trips the
"more than 0.1 km and more than 1%" length check in `verifyRouteData` and marks a
perfectly good route invalid. Silent false invalidations are much worse than a
slow import.

If the buffer is ever revisited, escalation would have to trigger on a length
mismatch too, not just on failure.

## Still on the table

- **Fold the length query into the `UPDATE`.** Each route costs an extra round
  trip for `ST_Length(...)::geography` before the write, because the result
  decides whether to invalidate. A single statement with a CTE could do both. At
  ~4.7k routes this is worth seconds, not minutes — the pathfinding dominates.
- **Cut the per-route part loading further.** Routes are processed in `track_id`
  order, which is roughly geographic, so consecutive routes reload much of the
  same neighbourhood. A shared LRU of parsed parts across workers would cut both
  the transfer and the parse, at the cost of holding geometry longer.

## Measuring

`npm run verifyRouteData` runs step 2 on its own against the current data, so it
can be timed without a full import; it prints its own elapsed time and the route
count as `Found N routes to recalculate`. `--valid-only` restricts it to routes
not already invalid, which is much faster — an invalid route escalates through
all three buffers, including the 222 km one, before giving up.

`npm run inspectPath -- "<from>" "<to>"` prints a single *journey planner* search
and the gaps between consecutive routes. Note that it exercises
`lib/routePathFinder.ts`, not the recalculation pathfinder, so it does not cover
changes made here.

## Regression check

Any change here must leave the *same* routes valid and invalid as before. Before
starting, capture the baseline:

```sql
SELECT track_id, is_valid, ROUND(length_km::numeric, 3) FROM railway_routes ORDER BY track_id;
```

Run it again afterwards and diff. Length may shift in the last decimal from
floating-point ordering, but `is_valid` must not change for any route, and no
route should gain or lose an `error_message`. The changes recorded above were
verified this way: over all 5531 routes, `is_valid`, `error_message` presence and
`length_km` to three decimals came out byte-identical, at every concurrency
tried.
