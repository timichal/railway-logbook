# HTTP API (`/api/v1`)

The API the **native app** talks to (see `MOBILE_APP_PLAN.md`). The web app does
not use it and does not need to — it keeps its server actions, and is therefore
the regression test for anything changed down here.

Everything is JSON in and JSON out. Read this together with `CLAUDE.md`, which
explains what the data *means*; this file only says how to ask for it.

## The rules that apply everywhere

**Versioned.** Every path starts `/api/v1/`. A binary in the wild cannot be
asked to change, so a breaking change means `/v2`, not an edit here.

**Auth is a bearer token.** `Authorization: Bearer <accessToken>`. The cookie is
never read by a handler, so a browser session cannot drive a mutating call by
accident. Signing is shared with the web session (`src/lib/authTokens.ts`): one
secret, one claim shape, two transports.

**`region` is required wherever it appears, and never defaults.** On the web the
region comes from a cookie; over HTTP a missing one would mean a query answering
for the other continent, so it is a 400. Values: `europe`, `japan`.

**Errors are `{ "error": "…" }`** with a real status code:

| Status | Means |
| --- | --- |
| 400 | the request is malformed, or a value was rejected (`name is required`) |
| 401 | no token, an expired one, or credentials that don't check out |
| 404 | the row isn't there, or isn't the caller's |
| 500 | a bug or a database failure. The message is opaque by design; the detail is in the server log |

A 404 rather than a 403 for someone else's journey: every query is scoped by
user id, so "not yours" and "not there" are the same answer, and saying which
would leak that the row exists.

**Nothing is cached.** Route Handlers are uncached in Next by default and none
of these opt in.

## Auth

| | |
| --- | --- |
| `POST /auth/login` | `{ email, password }` → the token pair. 401 on bad credentials |
| `POST /auth/register` | `{ email, password, confirmPassword, name? }` → 201 and the token pair. 400 with the message the web form would show |
| `POST /auth/refresh` | `{ refreshToken }` → a fresh pair. 401 if it is expired, invalid, or an access token |
| `GET /auth/me` | `{ user }` — who the token belongs to |

The pair is `{ user, accessToken, refreshToken, expiresIn }`, `expiresIn` in
seconds. The access token lasts **7 days**, the refresh token **180** — a
logbook is opened when a trip happens, and being logged out on a train is worse
than useless. Refreshing replaces both, so a client that checks in occasionally
never runs its window down.

Tokens are stateless: there is no server-side revocation and **no logout
endpoint**. Logging out is the client deleting both tokens, which is why they
belong in `expo-secure-store` and not in plain storage.

## Public reads

No token. These are the same data the tiles already serve to anyone.

| | |
| --- | --- |
| `GET /stations?region=&q=` | `{ stations }` — at most 10, `near_route` only, diacritic-insensitive. Under two characters returns none |
| `GET /routes?region=` | `{ routes }` — every route with geometry. Large: ~5500 for Europe, ~1300 for Japan |
| `GET /routes/track-ids?region=` | `{ trackIds }` — a few thousand integers, for telling which locally-held journeys belong to the region on screen |
| `POST /routes/metadata` | `{ trackIds }` → `{ routes }` without geometry. A POST for a read because the id list is the argument |
| `POST /coverage/stretches` | `{ ranges: [{ track_id, covered_start, covered_end }] }` → `{ stretches }` — fraction ranges cut into drawable geometry, for journeys held on the device. Validated and capped at 2000 |

## The user's own data

Bearer token required.

| | |
| --- | --- |
| `GET /progress?region=&countries=` | km and route counts. `countries` absent = no filter; `countries=` (empty) = filter everything out, which answers zeros. Regular routes only |
| `GET /progress/countries?region=` | `{ byCountry, total }` — one row per country the region declares, ridden or not |
| `GET /coverage` | `{ stretches }` — ridden stretches of routes not yet finished |
| `GET /preferences` | `{ selectedCountries }`, defaulted to every supported country on first read |
| `PUT /preferences` | `{ selectedCountries }` — a whole-list replacement, empty list allowed |

## Journeys

| | |
| --- | --- |
| `POST /journeys` | `{ name, date, description?, tripId?, routes }` → 201 `{ journey }`. Journey and logged parts commit together |
| `GET /journeys/:id` | `{ journey, routes }` — the routes carry `partial`, `covered_start`, `covered_end` |
| `PATCH /journeys/:id` | `{ name, date, description? }` → `{ journey }` |
| `DELETE /journeys/:id` | `{ success: true }`, logged parts included |
| `POST /journeys/:id/routes` | `{ routes }` — a route already logged has its flag and stretch overwritten, not duplicated |
| `PATCH /journeys/:id/routes/:trackId` | `{ partial }` → `{ success: true }` |
| `DELETE /journeys/:id/routes/:trackId` | unlog one route |
| `PUT /journeys/:id/trip` | `{ tripId }` — file the journey under a trip |
| `DELETE /journeys/:id/trip` | file it under none |
| `GET /journeys/unassigned?region=` | `{ journeys }` — the assignment picker's list |

**`routes` is one array of objects**, not the three positionally-aligned arrays
the query module takes:

```json
{ "routes": [
  { "trackId": 231 },
  { "trackId": 229, "partial": true, "covered": { "covered_start": 0.1, "covered_end": 0.42 } }
] }
```

`partial` defaults to `false`. `covered` is the stretch ridden as fractions
along the route geometry, and is **dropped unless `partial` is true** — a route
logged whole covers all of it, so a range would only draw a stray overlay. Both
fields absent means the extent is unknown, which is what a route ticked partial
by hand looks like.

Assignment is keyed on the journey because the journey is what changes: `trip_id`
is a column on it, and a journey belongs to at most one trip.

## Trips

| | |
| --- | --- |
| `GET /trips?region=` | `{ trips }` with stats. A trip with no logged routes yet belongs to every region, so a new one never vanishes from the list that made it |
| `POST /trips` | `{ name, description? }` → 201 `{ trip }` |
| `GET /trips/:id` | `{ trip, journeys, routeIds }` — `routeIds` is what the map highlights while the trip is open |
| `PATCH /trips/:id` | `{ name, description? }` → `{ trip }` |
| `DELETE /trips/:id` | its journeys survive, unassigned |
| `GET /logbook?region=&page=&pageSize=&search=` | `{ items, total }` — the browsing list: one row per trip (journeys nested) or standalone journey, newest first. `page` defaults to 1, `pageSize` to 10 (capped at 100) |

The logbook page is ordered and hydrated by the query, so a client must not
re-sort or re-filter a page it has been handed — it would be sorting one page of
a larger set.

## Journey planner

`POST /planner` — `{ fromStationId, toStationId, viaStationIds? }` →
`{ routes, totalDistance, error? }`. No token: route data is public and the
planner writes nothing.

**"No path found" is a 200 with an `error` string**, not an HTTP failure: the
request was fine, the network simply doesn't connect those stations by
regular-service routes, and that message belongs next to the form.

Station ids may be **negative** — a station whose OSM feature was an area is
stored under a negated id (see `CLAUDE.md`), so don't validate them as positive.

The search stays on the server for good: it needs Postgres and the in-memory
route graph. First and last routes come back trimmed to the stretch actually
travelled (`partial` geometry plus `travelled_length_km`), and `totalDistance`
counts only that.

## Not here

- **Admin** — route creation, geometry editing and notes stay web-only. It is a
  single-user surface and would roughly double this layer.
- **Shared public maps** (`/shared/<token>`) — still an open decision in
  `MOBILE_APP_PLAN.md`. The queries are already shared through
  `progressQueries.ts`, so the endpoints are a short afternoon if the app ends
  up opening those links rather than bouncing them to the browser.
- **localStorage migration** — web-only by nature.

## Where the code is

`src/app/api/v1/**/route.ts` are thin: resolve auth, validate, call a query
module, map the result. The query modules (`src/lib/*Queries.ts`) are plain
server-only modules taking a `userId`, shared with the web app's server actions —
**a handler never imports a `"use server"` action**, and the reason is in
`progressQueries.ts`'s header. Shared plumbing lives in `src/lib/api/`:
`auth.ts` (bearer + token issue), `params.ts` (every validation helper),
`response.ts` (status mapping, including how an in-band `{ error }` message
becomes a status code).
