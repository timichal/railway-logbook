# Native mobile app — plan (iOS + Android)

A real native app built on **React Native + Expo** with
**`@maplibre/maplibre-react-native`**, sharing one codebase across iOS and
Android. Written for someone fluent in JS/TS and React but new to mobile.

This is a separate project from the mobile-web work, which is finished: the *web*
app is pleasant on a phone and installable to the home screen (see the bottom
sheet, the touch sheets, the safe areas and the manifest in `CLAUDE.md`). This one
is a distinct app in the two stores.

---

## Why native, and the one thing that justifies it

Most of what a wrapper or an installable web app gives you, the web app already
has. The argument for going native is **offline maps**: you are on a train with
no signal, which is exactly when you want to look at the line and log the ride.
MapLibre Native can download offline tile packs; MapLibre GL JS in a browser or
webview cannot, in any way that survives a tunnel.

Everything else — store presence, an icon, native geolocation — is available more
cheaply. If offline stops being the goal, this plan stops being worth its cost;
re-read that decision before starting Phase 5.

Secondary wins that come along: real background/foreground geolocation, gesture
handling that feels native, and no `dvh`/safe-area/keyboard-inset fighting.

---

## What survives, and what gets rewritten

The split is sharper than it looks, and it is favourable.

### Ports nearly verbatim

These are plain data, style objects, or pure logic — no DOM, no browser:

- `src/lib/map/style.ts` — `COLORS`, `WIDTHS`, `CIRCLES`, `LABELS`, `OPACITIES`.
  The single source of truth stays the single source of truth.
- `src/lib/map/userMapLayers.ts` — the layer stack and paint configs. MapLibre
  style expressions are the same JSON on native.
- `src/lib/map/utils/userRouteStyling.ts`, `src/lib/map/utils/distance.ts`.
- `src/lib/regions.ts`, `routeCoverage.ts`, `constants.ts`, `types.ts`,
  `countryUtils.ts`, `coordinateUtils.ts`.
- `src/lib/routePathFinder.ts` stays **server-side** and is reached over HTTP —
  it needs Postgres and the in-memory graph cache, neither of which belongs on a
  phone.

### Rewritten

- **Every hook in `src/lib/map/hooks/`** — `useMapLibre`, `useRouteEditor`,
  `useStationSearch`, `useRouteHighlighting`, `useCoverageOverlay`,
  `useLayerFilters`, `useMapTileRefresh`. The RN binding is declarative
  (`<MapView>`, `<VectorSource>`, `<LineLayer>`) rather than the imperative
  `map.addLayer` / `moveLayer` / `setFilter` these are built on.
- **`src/lib/map/interactions/userMapInteractions.ts`** — `map.on("click")` plus
  `queryRenderedFeatures` becomes `onPress` on the individual layers. This is
  mostly a simplification: the station-wins-over-route special case exists
  because the web click handler is map-wide, and per-layer `onPress` makes it
  unnecessary.
- **`src/lib/map/utils/tooltipFormatting.ts`** — popups become RN components, so
  the HTML-string machinery goes away entirely and `escapeHtml` with it. Keep
  `safeHref`'s http(s) check, though: it still guards `Linking.openURL` against
  a route link edited by a third party.
- **`basemap.ts`** — the OpenFreeMap liberty URL carries over, but the Latin-label
  rewrite does not need to: MapLibre Native exposes label localization on the
  MapView directly. The POI-layer drop, the buildings flattening and the fade
  layer are all still wanted, applied against the native style object.
- **The whole component tree.** No DOM, no CSS. **NativeWind** gives you Tailwind
  class names in RN, which makes this mostly transcription rather than redesign —
  and the web app's mobile decisions (bottom sheet, tap-to-inspect, 44pt targets;
  all documented under **UI structure** in `CLAUDE.md`) are the ones you build here
  from the start.

### The hard blocker: the data layer

**The entire data layer is server actions, and React Native cannot call them.**
Twelve `"use server"` modules under `src/lib/`. The mobile app needs these:

| Module | Needed by mobile |
| --- | --- |
| `authActions.ts` | yes — login/register/session |
| `journeyActions.ts` | yes |
| `tripActions.ts` | yes |
| `userActions.ts` | yes — progress, coverage |
| `userPreferencesActions.ts` | yes — country filter, region |
| `routePathFinder.ts` | yes — journey planner |
| `publicMapActions.ts` | probably — opening a shared link |
| `migrationActions.ts` | no — localStorage migration is web-only |
| `adminMapActions.ts`, `adminNotesActions.ts`, `adminRouteActions.ts` | **no** — admin stays web-only |

So: REST or tRPC route handlers in front of them. Note that
`src/lib/progressQueries.ts` is deliberately *not* a `"use server"` module (see
its header comment) — it takes a `userId` argument, and the wrappers resolve
*which* user first. That separation is exactly the shape an HTTP API wants, so
follow it: **route handler resolves auth → calls the query module**, never the
other way round.

Silver lining: this is a refactor worth having regardless. Leaving the admin
actions out of it keeps the surface roughly half the size.

### Auth changes shape

Cookie sessions signed with `jose` become **bearer tokens in
`expo-secure-store`**. The JWT signing itself carries over; what changes is where
the token lives and that every route handler reads an `Authorization` header
instead of a cookie. Plan for token refresh — a logbook app that logs you out on
a train is worse than useless.

### Tiles are already fine

Production serves Martin through nginx at `/tiles` over HTTPS
(`docker-compose.yml` exposes Martin on 3001; `getTileBaseUrl()` in
`src/lib/map/index.ts:33-43` builds the public URL). Both platforms block
cleartext HTTP by default — iOS App Transport Security, Android since 9 — so
HTTPS is required, and you already have it.

One change: `getTileBaseUrl()` derives the host from `window.location`. In RN
there is no `window`; this becomes a build-time config constant per environment.

---

## Phases

Estimates assume **part-time work** (evenings and weekends) by someone strong in
JS/React and new to RN, vibe-coding with an assistant. Full-time, halve them.

### Phase 0 — Spike, before committing (2–3 days)

Do not skip this. Build a throwaway Expo app that shows the liberty basemap plus
**one** Martin vector layer of railway routes, on a real iPhone and a real
Android device. It answers the two questions that decide the whole project: does
the tile server behave against the native SDK, and does a 5000-route z4 tile
render at an acceptable frame rate on a mid-range phone.

If either answer is bad, that is worth knowing for three days rather than three
weeks.

### Phase 1 — HTTP API layer (1–1.5 weeks)

Route handlers under `src/app/api/` in front of the seven modules the app needs.
Token auth alongside the existing cookie auth, so the web app keeps working
untouched. Mechanical but broad; the web app is the regression test.

### Phase 2 — App shell (1 week)

Expo project, navigation, login/register against the new API, secure token
storage, region switching. No map yet.

### Phase 3 — The map (2–3 weeks)

The big one. Basemap plus every railway layer, the visit-status colouring, the
country and usage-type filters, station dots and labels, tap-to-inspect, the
highlight overlays, the ridden-stretch coverage overlay. Port `style.ts` and
`userMapLayers.ts` first — having the styling constants already correct is what
makes this three weeks instead of five.

### Phase 4 — Features (1.5–2 weeks)

Route logger, journeys and trips, the journey planner (calling the server
pathfinder), country stats, station search.

### Phase 5 — Offline (1.5–2 weeks)

The reason for the project, and it has a genuine design problem in it.

MapLibre Native offline packs cover any source in the style, so both the basemap
and the railway geometry can be downloaded. But **route colour depends on visit
status**, which the tile carries as a `user_id` query parameter and which changes
every time you log a ride — so a downloaded route tile goes stale the moment it
is useful. Likely resolution: pack the basemap and the route *geometry*, and
carry visit status locally, applying it as a style filter over a locally-held id
set rather than baking it into the tile. Decide this properly before building it.

Logging offline is the other half: an `expo-sqlite` mirror of the logged parts
plus a write queue and a sync story. Conflicts are mild here — journeys are
append-mostly and single-user — but "mild" is not "absent".

### Phase 6 — Store submission (1–2 weeks wall-clock, mostly waiting)

See requirements below. Budget for one rejection round on the Apple side.

**Total: roughly 8–12 weeks part-time**, of which Phases 1 and 3 are half.

---

## Requirements and costs

### You do not need a Mac

Worth stating plainly, since the dev machine here is Windows. **EAS Build**
compiles iOS binaries in the cloud, and **EAS Submit** uploads them — so iOS
shipping is possible from Windows. Two consequences to plan around:

- There is **no iOS Simulator on Windows** (it is macOS-only). iOS testing means
  a physical iPhone, via the Expo dev client or TestFlight. The Android emulator
  runs on Windows fine.
- Cloud builds are minutes each and metered on the free tier. Budget for either
  patience or a paid EAS tier during the heavy phases.

### Per platform

| | iOS | Android |
| --- | --- | --- |
| Developer account | Apple Developer Program, **$99/year** | Google Play, **$25 one-time** |
| Build from Windows | EAS Build (cloud) | EAS Build, or locally with Android Studio |
| Testing | physical device (no simulator on Windows) | emulator or device |
| Review | slower, stricter; expect a rejection round | faster, laxer |
| Store paperwork | screenshots at several sizes, privacy manifest, privacy policy URL | data safety form, target-API-level requirements |

Both stores need a privacy policy URL and an account-deletion path if the app has
accounts — which this one does.

### Also needed

- A physical iPhone and a physical Android device for real testing.
- Location-permission strings that explain *why*, for both stores.
- The API from Phase 1 deployed and versioned — once an app binary is in the
  wild, its API cannot break. Version the routes from day one.

---

## Open decisions

- **Offline route colouring** (Phase 5) — the stale-tile problem above. This is
  the one real design question in the project.
- **Does admin ship?** Recommend no. It is a single-user surface, it works on the
  web, and it would roughly double the API layer and the map work (route
  creation, geometry editing, notes).
- **Shared public maps** — does the app open a `/shared/<token>` link, or bounce
  it to the browser? Deep links are cheap; the read-only map view is not free.
- **One region or both?** Europe and Japan are already just bounding boxes, so
  both should come nearly free. Confirm during the Phase 0 spike that the tile
  volumes behave for both.
- **How much does the web app converge?** After Phase 1 the web app could also
  move off server actions onto the same HTTP API. Tempting for consistency, but
  it is a large refactor of working code for no user-visible gain. Recommend not
  doing it — let the two clients share the query modules, not the transport.
