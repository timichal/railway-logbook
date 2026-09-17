# AUDIT.md

Findings from a read-only sweep of the codebase on 2026-09-17. Nothing here has
been changed yet.

**How to use this file:** each item is self-contained — location, what is wrong,
why it matters, and a suggested fix. Work them in any order. **Delete an item
once it is done**; when the file is empty, delete the file. If an item turns out
to be wrong or deliberate, delete it too and (if the reasoning is worth keeping)
move a sentence into `CLAUDE.md` instead.

Baseline: `npx tsc --noEmit` and `npm run lint` are clean (items 1-7, 10, 13 and
20 have since been fixed or dismissed and removed).

---

## Bugs

### 8. Login is a user-enumeration oracle, and unthrottled

`src/lib/authQueries.ts:33` (`authenticateUser`)

An unknown email returns before `bcrypt.compare` runs; a known one spends ~250 ms
in it (cost 12). That timing difference enumerates registered addresses.

Neither `/api/v1/auth/login` nor `/api/v1/auth/register` has rate limiting, so the
same bcrypt cost is also a cheap CPU-exhaustion lever against an unauthenticated
endpoint.

**Fix:** compare against a fixed dummy hash on the miss path so both branches pay
the same cost. Rate limiting is a separate, larger decision — note it and move on
if it is out of scope.

---

### 9. `POST /api/v1/planner` is the only unauthenticated handler

`src/app/api/v1/planner/route.ts`

No `requireUser`. That the *search* needs no session is reasoned in
`src/lib/plannerActions.ts` and is fine. The problem is the size of what one
anonymous request can buy: `requireIntArray` caps `viaStationIds` at
`MAX_ARRAY_LENGTH` (2000), and each via station is another sequential Dijkstra run
over the route graph.

**Fix:** cap vias at something the UI can actually produce (10 or so), with its
own 400. Leaving the endpoint public is fine.

---

### 11. LIKE wildcards pass through station search

`src/lib/routeQueries.ts:51` (`searchStationsByName`)

```ts
[`%${searchQuery}%`, `${searchQuery}%`]
```

A query containing `%` or `_` becomes a wildcard, so searching `%` returns
arbitrary stations. Parameterized, so not injection — just wrong results, and an
unindexable scan.

**Fix:** escape backslash, `%` and `_` in the user's string before interpolating
it into the pattern.

---

### 12. Frequency tags are re-parsed from the Postgres array literal

`src/lib/map/utils/tooltipFormatting.ts` (`formatRouteMetadataBadges`)

The MVT property arrives as the raw `{a,b}` array literal and is picked apart by
hand — `slice(1, -1)`, `split(",")`, strip every `"` — so a tag containing a comma
renders as two badges and quoting is lost. Values do go through `escapeHtml`, so
this is cosmetic only.

**Fix:** emit the array properly from the tile function, or parse it correctly
(respecting quoting) in one shared helper.

---

## Refactors

### 14. `saveRailwayRoute` is not transactional

`src/lib/adminRouteActions.ts` (`saveRailwayRoute`, and `deleteRailwayRoute` below
it)

It takes a pooled client and issues four statements — read nearby stations,
insert/update the route, reclassify `line_class`, refresh station proximity — each
autocommitted. `duplicateRailwayRoute`, immediately below, does use
`BEGIN`/`COMMIT`.

A failure between the write and the reclassify leaves a route stuck at the default
`'branch'`; between the write and the refresh, stale `near_route` flags on the
user map.

**Fix:** wrap both in `BEGIN`/`COMMIT`/`ROLLBACK`, matching
`duplicateRailwayRoute`.

---

### 15. Admin BFS uses `Array.shift()` and `path.includes()` in the hot loop

`src/scripts/lib/railwayPathFinder.ts` (`findShortestPath`,
`findPathWithoutBacktracking`)

`queue.shift()` is O(n) per pop, and `current.path.includes(connectedId)` is
O(path) inside the inner loop. At the 222 km fallback buffer that is a lot of
parts, and `RECALC_PERFORMANCE.md` says recalculation dominates the import.

**Fix:** a head index instead of `shift`, and a `Set` carried alongside each path.
Neither changes the algorithm or the paths it returns.

**Read `RECALC_PERFORMANCE.md` first** — it lists constraints that must not be
broken while touching this file.

---

### 17. Asymmetric validation on the preferences endpoint

`src/app/api/v1/preferences/route.ts`

`GET` filters country codes through `/^[A-Z]{2}$/` (`optionalCountries` in
`src/lib/api/params.ts`); `PUT` accepts up to 2000 arbitrary strings of any length
via `requireStringArray` and stores them in `selected_countries`. Same list, two
standards.

**Fix:** validate on write with the same regex.

---

## Documentation nits

### 18. Stale country count in CLAUDE.md

`CLAUDE.md`, the `user_preferences` bullet, says the default is "(20 codes)". It
is 21, in both `src/lib/constants.ts` (`SUPPORTED_COUNTRIES`) and
`database/init/01-schema.sql`.

---

### 19. Comment contradicts the code on the backtracking allowance

`src/scripts/lib/railwayPathFinder.ts` and `src/lib/routePathFinder.ts`

```ts
// Allow searching for paths up to 10% longer or +5km
const searchDistance = Math.min(firstDistance * 1.1, firstDistance + 5000);
```

`Math.min` takes the **more** restrictive of the two, while "10% longer or +5km"
reads as the more permissive. Same phrasing around
`Math.min(best.cost * 2, best.cost + 20)` in `routePathFinder.ts`. The code is
probably right; the comments should say "whichever is smaller".

---

