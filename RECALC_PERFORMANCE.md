# Route recalculation performance

Read this before changing `verifyRouteData.ts` or `scripts/lib/railwayPathFinder.ts`
(or the `partNetwork.ts`, `partCatalog.ts` and `partGeometry.ts` beside it) for performance reasons. The work described here is **done**; what remains is the
reasoning behind the current shape, the constraints that must not be broken, and
the one thing still on the table.

## Why this step matters

`npm run importMapData` has three steps. Step 1 (loading stations and parts) is
I/O over a few gigabytes and finishes in minutes. Step 3 (station proximity) is a
single query. **Step 2 — recalculating every route against the new OSM data — is
where the import spends most of its wall-clock.** It is not where a deploy
spends it, though: preparing the map takes far longer (next section).

It is also, structurally, the easiest part of the pipeline to make fast: every
route is recalculated independently of every other one.

## Where a deploy's time goes

Measured 2026-11-15 on the dev machine (16 cores, local SSD, Dockerised
Postgres), from the timings `prepare.sh` and `importMapData` print: the
server's raw cache copied down (35 GiB, data of 2026-11-13), then a full
`prepareMapData` with `RAW_CACHE=data/raw`, updating every extract from
Geofabrik's diffs to 2026-11-14 as the server does, then `importMapData`. The
server's figures are from its deploy of 2026-11-14 (data of 2026-11-13), which
printed no step timings: step 1's end is the newest kept `.rail.pbf`'s mtime,
step 2 the recalculation's own `Time:` line, and the rest is what is left of
the log's start-to-finish.

| Step                                  | dev machine | server (2 vCPU) |
| ------------------------------------- | ----------- | --------------- |
| prepare 1: check, 54 updates, filters | 20m 40s     | ~97 min         |
| — of which `pyosmium-up-to-date`      | 15m 54s     |                 |
| — of which `tags-filter`              | 3m 58s      |                 |
| prepare 2–4: merge, export, prune     | 51s         | ~9 min, with    |
| import 1: load stations and parts     | 2m 17s      | the load        |
| import 2: part-routes snapshot        | 24s         | 80s             |
| import 2: recalculation (2552 routes) | 2m 13s      | 12.1 min        |
| import 3: station proximity           | 3s          |                 |
| **total**                             | **~26 min** | **~2 h**        |

**Step 1 of prepare is ~80% of a deploy on both machines, and most of it is
`pyosmium-up-to-date` rewriting each raw extract in full** — France 2m 0s,
Germany 1m 45s, Japan 1m 1s locally, while filtering each takes a quarter of
that. The diffs applied were one to two days' worth; a weekly deploy applies a
week's, but the rewrite of the whole file is the bulk of an update either way.
The recalculation is ~11%.

**Since 2026-11-15 the raw files are not rewritten on each update** ("Raw
cache" in `osmium-scripts/CLAUDE.md`): the diffs go into a change file beside
the raw file, and the kept filtered file gets them applied and is filtered
again. Measured on France with a week of diffs (2026-11-08 to 14) in an Ubuntu
26.04 container with the server's osmium and pyosmium, limited to 2 CPUs:

| France, one week of diffs                 | before | after           |
| ----------------------------------------- | ------ | --------------- |
| update (`pyosmium-up-to-date` / fetch)    | 208s   | 27s, network    |
| filter (`tags-filter` / apply + refilter) | 72s    | 7s              |
| raw read for newly tagged ways' nodes     | -      | 34s, some weeks |
| rebase, every ~4-5 weeks                  | -      | 208s            |

The output is the same file object for object (OPL), and so is Czechia's
with one and two weeks of diffs. The server's step 1 hasn't been measured
since (TODO.md).

**Since 2026-11-16 import step 1 writes only the parts that changed**
(`applyStagedParts`, `loadRailwayData.ts`): the parts are staged in a temp table
and compared with `railway_parts`, rather than all 1.5M being deleted and
reinserted. Locally, the full load of the same `pruned.geojson` went from 144s,
leaving 1.5M dead rows behind, to 80s whether nothing changed or ~2% did, with
dead rows only for those. Of the 80s, ~10s is reading the file, ~30s the staging
inserts (~10s of that server-side WKT parsing), ~6s the diff and ~5s stations.

The recalculation's own split (the summary's "Summed over the workers" lines,
`SearchTimings`), locally at 4 workers:

| Summed over the 4 workers     | time | per route |
| ----------------------------- | ---- | --------- |
| part queries (2582 loads)     | 278s | 109ms     |
| `JSON.parse` + `add`          | 75s  | 29ms      |
| end parts (`partsContaining`) | 17s  | 7ms       |
| search                        | 4s   | 2ms       |
| length query and `UPDATE`     | 156s | 61ms      |

The JS thread was busy 72% of the pool's 133s wall-clock (parse, end parts and
search, 96s), so it is close to the bottleneck at 4 workers, as the scaling
table below suggests. The two awaited figures include time queued behind that
thread, so they overstate Postgres. The search itself is negligible: what costs
is moving parts out of Postgres and parsing them, which the part catalog
(next) removed.

**Since 2026-11-16 every part is loaded once per run** (`PartCatalog`, see
"What it does now"). Measured locally over the same 2552 routes at 4 workers,
without the length query and writes, two runs each:

|                             | before   | after            |
| --------------------------- | -------- | ---------------- |
| catalog load (1.5M parts)   | -        | 12s              |
| pool wall-clock             | 112–119s | 56–62s           |
| part queries, summed        | 353–376s | 177–195s         |
| parse + `add`, summed       | 73–78s   | 26–29s           |
| peak RSS, heap capped 1.5GB | ~0.5GB   | 1.1GB (pool 71s) |

So ~115s became ~70s with the load, and the run now loads the catalog while
it takes the part-routes snapshot (26–41s), so the 12s is hidden behind it.
A full `verifyRouteData` with the writes then took 1.7 min locally (snapshot
and catalog 14s, recalculation 88s), against 24s + 2m 13s before. Summed over
the workers: part queries 152s, building parts 35s, end parts 21s, search 4s,
and the length query and write 137s, now the largest share. The part query that remains is Postgres's
spatial filter: ids only, it still took 20ms a route serially against 30ms with
the GeoJSON. The JS thread is still ~85% busy, now with the end parts, the
`RailwayPart`s made per load and the queries' own handling.

## What it does now

`recalculateAllRoutes` runs a fixed set of workers over the route list
(`runPool`, `scripts/lib/runPool.ts`), each pulling the next route off a shared
index and writing its own `UPDATE`:

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
- **A thrown error stops the run.** Pathfinding failure is already an outcome:
  `findPathFromCoordinates` returns null for it (the one failure that throws,
  "Chain is broken", is caught per part combination inside the finder), and
  `recalculateGeometry` turns that into an `invalid` outcome. It does
  **not** catch — it once did, and wrote a dropped connection into the route as
  `is_valid = FALSE`, which a recalculation then never rechecks. So an exception
  escaping `recalculateAndStoreRoute` means the database is unhappy — `runPool`
  stops the other workers taking new routes, and it propagates. Marking a
  route invalid over a transient fault would be worse than failing loudly.
- **The search is Dijkstra over a binary heap (`minHeap.ts`), with a parent per
  state instead of a path copied into every queue entry.** It replaced a BFS by
  part count and a label-correcting FIFO search for the non-backtracking
  alternative, which copied the path on every push and checked it for cycles
  with `path.includes()`. Over all 2142 valid routes and scenic lines the summed
  finder time was the same as before (1241s against 1258s at 4 workers): as
  below, the time is in loading parts, not in searching them.
- **Which routes run along which parts is one query per run, not per route**
  (`loadAllPartRoutes`, for `avoidOtherRoutes`). Network-wide it costs 26–41s
  locally, with the routes cut into 32-vertex pieces (`ST_Subdivide`) so the
  parts' index is probed with tight boxes; joined whole, a long route's box
  pulls in most of a country and it took 2.6 minutes. Per route instead
  (`loadPartRoutesAround`, ~250ms for a 50km area) it would add ~2 minutes to
  a run at 4 workers, and the outcome would depend on which routes the run had
  already rewritten. The snapshot is ~285k entries in memory.
- **`RailwayPathFinder` takes `{quiet: true}`** instead of having its output
  silenced from outside. The old code swapped out the global `console.log` around
  each search and restored it in a `finally`; that is safe only while calls are
  strictly serial. With two in flight the first to finish un-silences the rest,
  and a call that starts while the patch is in place captures the no-op as its
  "original" and silences logging permanently. (`mergeLinearChain` used to take
  the same logger for the same reason; it no longer logs anything.)
- **The route list query selects only what recalculation reads.** It used to
  fetch `starting_part_id`, `ending_part_id` and `ST_AsGeoJSON(geometry)`, none
  of which anything read — the geometry is replaced wholesale. That was ~16 MB of
  GeoJSON text for 1744 routes (~50 MB for a full run) serialised, shipped and
  held in Node for nothing.
- **One query loads both endpoints' surroundings**
  (`PartNetwork.loadAround`), against the GIST-indexed
  `railway_parts.geometry_3857` with `ST_DWithin`. It used to be two queries, one
  per endpoint, each materialising an `ST_Buffer` 32-gon and testing
  `ST_Intersects` against the WGS84 column. For any route shorter than the buffer
  — most of them — the two disks overlap almost entirely, so every part in the
  overlap was selected, encoded as GeoJSON, shipped and `JSON.parse`d twice, only
  for the second copy to be dropped as a duplicate.
- **A click point off the network fails at once.** The part containing a
  coordinate lies within 1 m of it, so if the 50 km load holds none, the 100 km
  and 222 km loads cannot either — the buffer only ever adds parts farther away.
  `findPathFromCoordinates` returns null there instead of escalating. This is the
  commonest way a route breaks after an OSM update, and each such route used to
  pay for the two largest loads to find the same nothing. The ladder itself is
  untouched (see "Do not shrink the buffer"): a route whose ends are both on the
  network but unconnected still escalates — and by the same argument it reuses
  the end parts found on the first pass rather than rescanning every segment of
  the larger load for them (same set, and same order, every load being
  `ORDER BY id`).
- **A part's length, endpoint keys and neighbours are computed once, not per
  hop.** Each part carries its haversine
  `lengthMeters` and its endpoint keys from `PartNetwork.add`, and
  `PartNetwork.connected` caches its sorted neighbour list per part — cleared
  whenever a part is added, since a part's neighbours depend on everything
  loaded. The search used to re-sum a part's haversines on every relaxation and
  rebuild and sort a `Set` on every pop. (`pathDistance`, which sums a whole
  path, is now only for log lines, and a quiet run skips it.) The
  turn check per relaxation (`turnDegrees`, two bearings) is still computed each
  time, deliberately: only the search without backtracking makes it, which only
  the few routes whose shortest path backtracks ever run. Caching it per part
  end would buy little; the time is in loading parts (see "Where a deploy's time goes").
- **Every part is loaded once per run, and a route's load fetches ids only**
  (`PartCatalog`, `partCatalog.ts`). `verifyAndRecalculateRoutes` loads it on
  first need (not for an empty table), beside the part-routes snapshot, and
  shares it between the routes and the scenic lines; the admin preview and `showBacktracking` load per search as
  before. Postgres still decides which parts a route loads and in what order:
  the query is the same but for the geometry column. The order is **text
  order**, as `ORDER BY id` binds to the `id::TEXT` output column, and it
  decides which of two equally short end-part combinations wins, so keep it.
  - **Bit-identical.** The coordinates come from the same `ST_AsGeoJSON` text
    through the same `JSON.parse`, held in a `Float64Array`, which keeps a
    double exactly; length and endpoint keys are the same functions on the
    same numbers. Each load makes its parts afresh from the catalog and
    indexes them as `add` does, so a part's neighbours are still those among
    the parts loaded. Verified over all 7412 routes and scenic lines (invalid
    and closed included): the previous finder and the new one back to back,
    `PathResult` JSON equal for every one, the 71 nulls included.
  - **Compact for the 4GB server.** Held as `RailwayPart`s (a `[lng, lat]`
    array per vertex) the 1.5M parts took 1.7GB of heap and 2.1GB RSS; as one
    flat buffer (14.7M vertices, ~270MB) with the keys interned, ~250MB of heap
    beside it. Under a 768MB heap cap the whole run still finished (1.0GB RSS,
    pool 74s), so `importMapData` and `verifyRouteData` run capped at 1.5GB:
    uncapped, V8 let the garbage of the per-route loads grow RSS to 1.9GB.
  - **It is a snapshot.** A part id the query returns that it doesn't hold
    stops the run; a part changed in place under its id is served as it was.
    Either takes a `verifyRouteData` alongside an import, whose own
    recalculation then replaces that run's results.
  - The summary's "building parts" is making the `RailwayPart`s and indexing
    them, which was the GeoJSON parse before.
- **`loadRailwayParts`, the part-id-based loader, is gone.** Nothing called it,
  and it was the last carrier of the superseded `ST_Buffer` pattern. If part-id
  loading is ever wanted again, build it on `ST_DWithin` against `geometry_3857`
  like its coordinate-based sibling.

Measured on a 16-core dev box against a Dockerised Postgres holding 1.44M
railway parts, over a sample of 200 valid routes spread across the whole set
(the first N by `track_id` all sit in one country, and cost varies hugely with
network density):

|                                       | ms/route |
| ------------------------------------- | -------- |
| two buffered queries, serial (before) | 326      |
| one indexed query, serial             | 242      |
| one indexed query, 2 workers          | 170      |
| one indexed query, 4 workers          | 157      |
| one indexed query, 8 workers          | 155      |

**~2.1× overall at the default of 4.** Scaling flattens hard after 2 — the work
is a mix of Postgres-side spatial filtering and Node-side JSON parsing, and this
box saturates one of them early. (Measured before the part catalog.) Measure
on the deploy host before raising the default there; the ceiling is memory as
much as CPU, since each worker holds its own bufferful of `RailwayPart`s.

**The heap limit has to reach the script.** `node --max-old-space-size=N
./node_modules/tsx/dist/cli.mjs script.ts`, which `importMapData` used to be
(at 8192), never applied: tsx's CLI runs the script in a child process, which
got V8's default, sized from the machine's memory. The scripts run
`node --max-old-space-size=1536 --import tsx script.ts` instead, in one process.

A full `verifyRouteData` over 1744 valid routes takes about 5 min at
the default concurrency. Treat single-run timings as rough: repeated runs on the
same box varied by well over a minute.

## Do not shrink the buffer

Tempting, and wrong. The `[50000, 100000, 222000]` ladder in
`findPathFromCoordinates` only escalates when **no path is found**. A tighter
first pass that happens to find a _longer_ path — because the true shortest one
left the loaded area — returns that longer path instead, which then trips the
"more than 0.1 km and more than 1%" length check in `verifyRouteData` and marks a
perfectly good route invalid. Silent false invalidations are much worse than a
slow import.

If the buffer is ever revisited, escalation would have to trigger on a length
mismatch too, not just on failure.

## Don't skip routes the import didn't touch

The idea: after an import that knows which parts changed, skip every route with
no changed part (old or new geometry) within its first-pass 50km load. Measured
2026-11-16 and dropped. A 50km disk around each endpoint is too wide for that to
spare many routes, even over a few days of edits.

The measurement: older Geofabrik files filtered, exported and pruned as
`prepare.sh` does, then diffed against the Nov 14 extracts on what
`railway_parts` stores (id, geometry, `usage`, `highspeed`). It counted the
non-closed routes with both endpoints in the country that have a changed part
within 50km of either endpoint (`withinMetersSql`, as `loadAround`):

| Extract     | Span    | Parts changed (of)        | Routes with a change within 50km |
| ----------- | ------- | ------------------------- | -------------------------------- |
| Czechia     | 5 days  | 232 (62.5k): +40 −3 ~189  | 441 of 537 (82%)                 |
| Czechia     | 13 days | 455 (62.5k): +130 −6 ~319 | 515 of 537 (96%)                 |
| Switzerland | 5 days  | 35 (50.8k): +7 −4 ~24     | 309 of 400 (77%)                 |
| Japan       | 5 days  | 91 (134k): +9 −0 ~82      | 844 of 1376 (61%)                |

Even Switzerland's 35 changed parts reach three routes in four. The European
figures are lower bounds, since changes in the neighbouring extracts weren't
counted; Japan has no neighbours, and its long, thin network leaves more routes
far from any edit. The skip would also need the `partRoutes` and first-pass
conditions to hold, so at weekly deploys it would spare at most about a quarter
of the recalculation: 2–3% of a deploy (the recalculation is ~11%). Not worth a second way for a route to end
up with stale geometry. Importing only the changed parts is a separate question:
under 1% of parts change in a week.

## Still on the table

- **Fold the length query into the `UPDATE`.** Each route costs an extra round
  trip for `ST_Length(...)::geography` before the write, because the result
  decides whether to invalidate. A single statement with a CTE could do both. At
  ~4.7k routes this is worth seconds, not minutes — the pathfinding dominates.

## Measuring

`npm run verifyRouteData` runs step 2 on its own against the current data, so it
can be timed without a full import; it prints its own elapsed time and the route
count as `Found N routes to recalculate`, and under each summary the time
summed over the workers per phase and how busy the JS thread was (see "Where a
deploy's time goes"). `importMapData` prints each step's time, and `prepare.sh`
each update's, download's, filter's and step's. Only valid routes are recalculated,
which also keeps it fast: an invalid route whose ends are on the network but
unconnected would escalate through all three buffers, including the 222 km one,
before giving up. (One with an end off the network gives up after the first.)

`npm run inspectPath -- "<from>" "<to>"` prints a single _journey planner_ search
and the gaps between consecutive routes. Note that it exercises
`lib/routePathFinder.ts`, not the recalculation pathfinder, so it does not cover
changes made here.

## Regression check

Any change here must leave the _same_ routes valid and invalid as before. Before
starting, capture the baseline:

```sql
SELECT track_id, is_valid, ROUND(length_km::numeric, 3) FROM railway_routes ORDER BY track_id;
```

Run it again afterwards and diff. Length may shift in the last decimal from
floating-point ordering, but `is_valid` must not change for any route, and no
route should gain or lose an `error_message`.

The head-index change above was verified this way over all 6874 routes, and the
diff was taken on **`md5(ST_AsBinary(geometry))` as well** — stricter than the
rounded length, and the thing actually worth holding constant. Both runs started
from the same input: the table was copied to a scratch table first, the new code
run, the results snapshotted, the table restored from the copy, and the previous
`railwayPathFinder.ts` (out of git) run against that identical starting state.
`is_valid`, `error_message`, `length_km` to three decimals, `has_backtracking`
and the geometry hash came out identical for every one of the 6874 routes.

Restoring between the runs is what makes them comparable: recalculation writes
`length_km`, and the length check compares against the stored value, so a second
run over the first run's output is not the same experiment. Station proximity is
derived from route geometry, so a restore has to be followed by
`refreshAllStationProximity` to leave the database consistent.

Cheaper than a full pair of runs, and enough for most changes: pull the previous
finder out of git and run both through `findPathFromCoordinates` over a sample,
comparing `partIds`, `coordinates`, `hasBacktracking` and `backtrackingAt` in
memory, with no writes at all. Sample the routes that reach the code being
changed — for the backtracking search, all the routes with `has_backtracking`
(the only ones that run it) plus the longest few, which are the routes
whose buffer escalates and whose queues get large.

The early exit for an off-network click point, the reused end parts and the
per-part precomputation were verified the second way, over all 6874 routes rather
than a sample: the previous finder and the new one ran on each route back to back,
and their `PathResult`s compared equal as JSON (so to the bit) for every one, the
71 null results included. Summed per-route time fell from 9071s to 8108s at 8
workers; the gain is concentrated on routes with an end off the network, which
went from 20-55s to 1-7s each.

The earlier changes recorded above were verified the first way: over all 5531
routes, `is_valid`, `error_message` presence and `length_km` to three decimals
came out byte-identical, at every concurrency tried.
