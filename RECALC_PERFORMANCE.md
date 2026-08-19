# Speeding up route recalculation

Planned work, not yet done. Written up so it can be picked up cold.

## The problem

`npm run importMapData` has three steps. Step 1 (loading stations and parts) is
I/O over a few gigabytes and finishes in minutes. Step 3 (station proximity) is a
single query. **Step 2 — recalculating every route against the new OSM data — is
where the import spends most of its wall-clock**, and it is the reason a deploy
takes as long as it does.

It is also, structurally, the easiest part of the pipeline to make fast: every
route is recalculated independently of every other one.

## Where the time goes

`src/scripts/verifyRouteData.ts:116` walks the routes one at a time:

```ts
for (const route of routes.rows) {
  const recalcResult = await recalculateRoute(client, startingCoordinate, endingCoordinate);
  ...
}
```

That is ~4.7k regular routes today, plus whatever Japan adds. For each one,
`recalculateRoute` builds a fresh `RailwayPathFinder` and calls
`findPathFromCoordinates` (`src/scripts/lib/railwayPathFinder.ts:240`), which:

1. Loads every railway part within **50 km of the start coordinate**
   (`railwayPathFinder.ts:254`).
2. Loads every railway part within **50 km of the end coordinate**
   (`railwayPathFinder.ts:255`).
3. Builds an in-memory graph from them and runs BFS.

So for a 5 km branch line, two ~7,800 km² disks are fetched — overlapping almost
completely — and every part in them is `ST_AsGeoJSON`'d, shipped over the wire and
`JSON.parse`d. Twice. In the Ruhr or the Randstad that is a great deal of
geometry for one short route.

The loading query itself (`railwayPathFinder.ts:108-128`) materialises a buffer
polygon and intersects against the WGS84 column:

```sql
WITH search_area AS (
  SELECT ST_Transform(ST_Buffer(ST_Transform(ST_SetSRID(ST_MakePoint($1,$2),4326),3857),
                                $3 / GREATEST(cos(radians($2)), 0.01)), 4326) as buffer_geom
)
SELECT id::TEXT as id, ST_AsGeoJSON(geometry) as geometry_json
FROM railway_parts rp, search_area
WHERE ST_Intersects(rp.geometry, search_area.buffer_geom) AND rp.geometry IS NOT NULL
```

## Fix it in this order

### 0. Remove the blocker first: `console.log` monkey-patching

`verifyRouteData.ts:35-36` silences the pathfinder by swapping out the global
`console.log`, restoring it in a `finally` at line 61:

```ts
const originalLog = console.log;
console.log = () => {}; // Suppress all output
```

This is safe only because calls are strictly serial. Run two at once and the
first to finish un-silences the rest; worse, an overlapping call captures the
already-replaced no-op as its `originalLog` and logging is silenced permanently.

**Do this before touching anything else**: give `RailwayPathFinder` a `quiet`
option (or an injected logger) and delete the global patch. It is a mechanical
change and it is a hard prerequisite for step 1.

### 1. Parallelise the loop

Each route is independent, so run several at a time. Notes:

- `recalculateAllRoutes` currently receives a single `pg.Client`. node-pg
  serialises concurrent queries on one connection, so real parallelism needs a
  `Pool`. `importMapData.ts` passes its own client through — it will need to hand
  in a pool, or the recalc step will need to open one itself.
- The load step now runs in a transaction (`loadStationsAndParts`), but it
  commits before recalculation begins, so a separate pool here is fine.
- Start at 4 concurrent workers and measure before going higher. Each worker
  holds its own 50 km of parsed geometry, so memory is the limit, not Postgres —
  this is why `importMapData` runs with `--max-old-space-size=8192`.
- Keep the per-route `UPDATE`s as they are (autocommitted, one per route). Do not
  wrap the whole recalculation in one transaction: it would hold row locks on
  `railway_routes` for the length of the import.
- The result aggregation (`result.errors`, `result.backtrackingRoutes`) is
  order-dependent only in presentation; sort at the end if the output order
  matters.

Expected payoff: close to linear in worker count, since the work is a mix of
Postgres-side spatial filtering and Node-side parsing.

### 2. One query per route instead of two

Replace the two `loadRailwayPartsAroundCoordinate` calls with a single query
covering both endpoints:

```sql
WHERE ST_DWithin(rp.geometry_3857, $start, $radius)
   OR ST_DWithin(rp.geometry_3857, $end,   $radius)
```

For any route shorter than the buffer — most of them — the two disks overlap
heavily, and today every part in the overlap is fetched, transferred and parsed
twice. `parseAndStoreParts` dedupes by id, so the second copy is pure waste.

### 3. Use the index that already exists

`ST_Buffer` builds a 32-gon per call and then `ST_Intersects` tests against it.
`ST_DWithin` against `railway_parts.geometry_3857` — GIST-indexed as
`idx_railway_parts_geometry_3857` (see `database/init/02-vector-tiles.sql`) —
gives the same set with no polygon materialisation.

The existing query already does its distance maths in 3857 with `1/cos(lat)`
scaling, so the semantics are unchanged; it just stops round-tripping through
WGS84. `src/lib/stationProximity.ts:26` and `src/lib/routePathFinder.ts:147` are
the in-repo precedents for the scaling expression — copy the pattern from there.

## Do not shrink the buffer

Tempting, and wrong. The `[50000, 100000, 222000]` ladder at
`railwayPathFinder.ts:245` only escalates when **no path is found**. A tighter
first pass that happens to find a *longer* path — because the true shortest one
left the loaded area — returns that longer path instead, which then trips the
"more than 0.1 km and more than 1%" length check in `verifyRouteData` and marks a
perfectly good route invalid. Silent false invalidations are much worse than a
slow import.

If the buffer is ever revisited, escalation would have to trigger on a length
mismatch too, not just on failure.

## Measuring

`npm run verifyRouteData` runs step 2 on its own against the current data, so it
can be timed without a full import. Take a baseline before starting; the route
count is printed as `Found N routes to recalculate`.

`npm run inspectPath -- "<from>" "<to>"` prints a single search's timing and the
gaps between consecutive routes — useful for checking that a change to the
loading query has not altered which path is found.

## Regression check

Any change here must leave the *same* routes valid and invalid as before. Before
starting, capture the baseline:

```sql
SELECT track_id, is_valid, ROUND(length_km::numeric, 3) FROM railway_routes ORDER BY track_id;
```

Run it again afterwards and diff. Length may shift in the last decimal from
floating-point ordering, but `is_valid` must not change for any route, and no
route should gain or lose an `error_message`.
