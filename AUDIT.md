# AUDIT.md

Findings from a read-only sweep of the codebase on 2026-09-17. Nothing here has
been changed yet.

**How to use this file:** each item is self-contained — location, what is wrong,
why it matters, and a suggested fix. Work them in any order. **Delete an item
once it is done**; when the file is empty, delete the file. If an item turns out
to be wrong or deliberate, delete it too and (if the reasoning is worth keeping)
move a sentence into `CLAUDE.md` instead.

Baseline: `npx tsc --noEmit` and `npm run lint` are clean (items 1-5 and 20 have
since been fixed and removed).

---

## Bugs

### 6. The terminal-route trim recomputes a side the search already knew

`src/lib/routePathFinder.ts:845` and `:855` (`computeTravelledTrims`)

It calls `connectingSide` → `findConnectionEndpoint`, i.e. the *closest* endpoint
pairing, to decide which half of a terminal route was covered. But `SearchState`
carried the actual `exitSide` and `SearchResult` throws it away.

Inside a junction complex, several of the four pairings can sit under the 500 m
`ENDPOINT_TOLERANCE_METERS` at once, and the closest need not be the one
traversed — the partial stretch is then cut on the wrong side of the station.

**Fix:** return the per-hop exit sides alongside `path` from `findShortestPath`
and use them in the trim, so it is exact rather than inferred.

---

### 7. `duplicateRailwayRoute` clones every user's logs

`src/lib/adminRouteActions.ts:539`

```sql
INSERT INTO user_logged_parts (...)
SELECT user_id, journey_id, $2, partial, covered_start, covered_end, created_at
FROM user_logged_parts WHERE track_id = $1
```

No user filter — deliberate per the docstring, and right while the copy is an
exact clone. But the copy exists to be re-pointed at a different stretch, and
after that every user who rode the original has both stretches logged, inflating
completed km for track they never rode.

**Fix:** decide the intent. Either clone only the acting admin's rows, or leave
the copy's logs empty and let the admin re-log, or keep the current behaviour and
write the trade-off into `CLAUDE.md` so it is a decision rather than a surprise.

---

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

### 10. First-read race on user preferences

`src/lib/preferencesQueries.ts:32` (`selectedCountriesForUser`)

Bare `SELECT` then `INSERT`. Two concurrent first reads for the same user race on
the primary key; the loser's unique violation is swallowed by the catch and
re-thrown as `"Failed to fetch user preferences"`, which the page surfaces as a
hard failure.

**Fix:** `ON CONFLICT (user_id) DO NOTHING` followed by a re-select — or model it
on `getPublicMapSettings` in `publicMapActions.ts`, which already does the whole
thing as one upsert with `RETURNING`.

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

### 13. The one hardcoded region check

`src/components/map/LayerToggles.tsx:34`

```tsx
label={region.id === "japan" ? "Non-JR lines" : "Special services"}
```

This is the **only** `region.id === "..."` comparison in `src/` — everything else
goes through the declarative `Region` flags. `Region.usageLabels`
(`{ 0: "JR line", 2: "Non-JR line" }`) exists for exactly this, and
`regionUsageLabel(region.id, 2)` is the intended call. A third region with renamed
usage types would silently get "Special services" here.

Note the label is plural here ("Non-JR line**s**") where `usageLabels` is
singular, so the fix needs a small pluralisation decision.

---

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

### 16. Redundant layer rebuild on every mount

`src/components/map/RailwayMap.tsx` — the "Force map refresh when user changes"
effect

It has `user` in its deps, so it also fires on mount. `useMapTileRefresh` then
immediately removes and re-adds the five route layers that `useMapLibre` created
moments earlier.

**Fix:** compare against a ref holding the previous user id and skip the first
run.

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

