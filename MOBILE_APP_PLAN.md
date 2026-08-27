# Native mobile app — plan (iOS + Android)

A real native app built on **React Native + Expo** with
**`@maplibre/maplibre-react-native`**, sharing one codebase across iOS and
Android. Written for someone fluent in JS/TS and React but new to mobile.

This is a separate project from the mobile-web work, which is finished: the *web*
app is pleasant on a phone and installable to the home screen (see the bottom
sheet, the touch sheets, the safe areas and the manifest in `CLAUDE.md`). This one
is a distinct app in the two stores.

---

## STATUS — read this first

**This file is the handoff document between sessions.** Keep it current: when a
phase moves, edit the phase's own section rather than appending a note elsewhere,
and add a line to the Session log at the bottom.

| | |
| --- | --- |
| **Branch** | `mobile-app` — all of this work lives here, not on `main` |
| **Current phase** | Phase 0 — spike **run on a physical iPhone**; both headline questions answered, one upstream bug found and worked around |
| **Blocked on** | nothing |
| **Next** | Collect the remaining device answers (fps, Japan's Latin labels, heritage/special rendering, Android), then decide go / no-go before starting Phase 1 |

**On the Mac:** `git fetch && git checkout mobile-app`, then follow
`mobile-spike/README.md` from the top — it assumes no mobile tooling is installed.

### Done

- **Phase 0 spike written** — `mobile-spike/`, with its own README covering setup
  from scratch, how to read the HUD, and a findings template to fill in.
- **Phase 0 spike run on a physical iPhone** (Xcode 26.6, iOS 26). Route tiles
  render on the native SDK and the styling port works; a launch crash traced to
  the binding's expression conversion is fixed by restructuring the colour
  expression. See Phase 0 below for the findings, and "The colour expression"
  for the one thing that changed in the web app as a result.

### Hardware reality (differs from what this plan originally assumed)

Available: a **Mac**, an **iPhone**, and the Windows PC this repo lives on. **No
Android device.** None of them set up for mobile development yet — no Xcode, no
Android Studio, no Expo tooling.

Two consequences, both good news against the original plan:

- The long "You do not need a Mac" section below is no longer a constraint being
  worked around. Build iOS locally on the Mac with Xcode; EAS becomes a
  convenience rather than a necessity, and the $99/year Apple account is only
  needed to *ship*, not to test on your own device.
- **Android frame rate cannot be measured yet.** An emulator answers "do the
  tiles load and the expressions parse on the Android renderer", which is worth
  having, but any fps number it produces is meaningless. Report it as unanswered
  rather than guessing.

### Corrections to this plan, found while building the spike

These were wrong in the original text and are fixed in place below. Listed here
so a future session knows they were checked against the real library
(`@maplibre/maplibre-react-native` **11.3.7**, Expo SDK **57**) rather than
assumed.

- **`localizeLabels` does not exist.** The plan claimed native "exposes label
  localization on the MapView directly" — true of rnmapbox, not of this binding.
  So `latinizeLabels` **does** port over, which matters for Japan. It works
  because `mapStyle` takes `string | StyleSpecification`: fetch the style,
  process it exactly as the web app does, hand over the object.
- **Expo Go cannot run this app.** The binding ships native code, so every run
  needs a development build (`expo run:ios`) plus its config plugin in
  `app.json`. This is the single biggest practical difference from ordinary Expo
  work.
- **The v11 component names are different.** `<MapView>` is `<Map>`;
  the pieces are `<Map mapStyle>`, `<Camera initialViewState>`,
  `<VectorSource tiles>`, `<Layer type source-layer paint layout>`.
- **`LngLatBounds` is flat `[west, south, east, north]`**, not the web app's
  nested `[[w, s], [e, n]]`. A silent porting trap in `regions.ts`.
- **The styling ports better than "nearly verbatim".** `<Layer>`'s props *are*
  `LayerSpecification` (with `id`/`source` made optional, plus
  `beforeId`/`afterId`/`layerIndex` — so the web app's `moveLayer` ordering has a
  declarative equivalent). And the binding depends on
  `@maplibre/maplibre-gl-style-spec`, the same package `maplibre-gl`'s types come
  from, so the ported expressions typecheck against the **identical**
  `ExpressionSpecification`. The port can be properly typed, not loosely.
- **Typechecking against the same spec does not mean the expression works.**
  Found on the device, not at the desk: the binding throws `std::bad_alloc`
  converting some spec-valid expressions to native style values. See "The colour
  expression" below. Nothing in the type system or in `npx tsc --noEmit` catches
  it, and the process dies with no JS error and no crash report — so an
  expression that typechecks still has to be *run*.

### Two repo-hygiene facts the spike introduced

Both are needed and neither is optional:

- `tsconfig.json` **excludes `mobile-spike`**. The root `include` is `**/*.ts`,
  so without it React Native's global `setTimeout` declaration leaks into the web
  app's program and breaks `JourneyPlanner.tsx` and `useStationSearch.ts` with
  `Type 'number' is not assignable to type 'Timeout'`.
- `biome.json` excludes it too — different toolchain and conventions, and the
  `next` lint domain has nothing useful to say about RN code.
- `mobile-spike/metro.config.js` pins `nodeModulesPaths` and sets
  `disableHierarchicalLookup`, because the spike sits inside a repo whose parent
  `node_modules` carries a different React. Without it Metro can load two copies.

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
  style expressions are the same JSON on native, and the same *types*: the
  binding depends on `@maplibre/maplibre-gl-style-spec`, which is where
  `maplibre-gl`'s `ExpressionSpecification` comes from too. The whole ported
  stack in `mobile-spike/src/railwayStyle.ts` typechecks against it unchanged.
- `src/lib/map/utils/userRouteStyling.ts`, `src/lib/map/utils/distance.ts`.
- `src/lib/regions.ts`, `routeCoverage.ts`, `constants.ts`, `types.ts`,
  `countryUtils.ts`, `coordinateUtils.ts`. One trap in `regions.ts`: the
  binding's `LngLatBounds` is flat `[west, south, east, north]`, so `bounds`
  needs converting rather than passing through.
- `src/lib/routePathFinder.ts` stays **server-side** and is reached over HTTP —
  it needs Postgres and the in-memory graph cache, neither of which belongs on a
  phone.

### Rewritten

- **Every hook in `src/lib/map/hooks/`** — `useMapLibre`, `useRouteEditor`,
  `useStationSearch`, `useRouteHighlighting`, `useCoverageOverlay`,
  `useLayerFilters`, `useMapTileRefresh`. The RN binding is declarative
  (`<Map>`, `<Camera>`, `<VectorSource>`, `<Layer>`) rather than the imperative
  `map.addLayer` / `moveLayer` / `setFilter` these are built on. Layer *ordering*
  survives the move: `<Layer>` takes `beforeId` / `afterId` / `layerIndex`, which
  is what the coverage overlay's repeated `moveLayer` becomes.
- **`src/lib/map/interactions/userMapInteractions.ts`** — `map.on("click")` plus
  `queryRenderedFeatures` becomes `onPress` on the individual layers. This is
  mostly a simplification: the station-wins-over-route special case exists
  because the web click handler is map-wide, and per-layer `onPress` makes it
  unnecessary.
- **`src/lib/map/utils/tooltipFormatting.ts`** — popups become RN components, so
  the HTML-string machinery goes away entirely and `escapeHtml` with it. Keep
  `safeHref`'s http(s) check, though: it still guards `Linking.openURL` against
  a route link edited by a third party.
- **`basemap.ts`** — ports almost entirely, and more of it than first thought.
  ~~The Latin-label rewrite does not need to carry over: MapLibre Native exposes
  label localization on the MapView directly.~~ **Wrong** — that is rnmapbox's
  `localizeLabels`; this binding has no such prop, so `latinizeLabels` carries
  over with everything else. All four transforms (POI drop, buildings flattening,
  Latin labels, fade layer) apply to a fetched style object which is then handed
  to `<Map mapStyle>`, since it accepts `string | StyleSpecification`. Confirmed
  working shape in `mobile-spike/src/basemapStyle.ts`; whether the labels *render*
  in Latin is a Phase 0 question below.
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

### Phase 0 — Spike, before committing (2–3 days) — **RUN; both headline questions answered**

Do not skip this. It answers the two questions that decide the whole project:
does the tile server behave against the native SDK, and does a 5000-route z4 tile
render at an acceptable frame rate on a phone. If either answer is bad, that is
worth knowing for three days rather than three weeks.

**The spike is written: `mobile-spike/`.** Its own `README.md` has the
from-scratch setup for the Mac, how to read the on-screen meter, and the findings
template. It went slightly beyond "one layer" because the extra layers cost
almost nothing and each answers something: the real six-layer stack, both
regions, station labels (the glyph path), and a toggle for `?user_id=1` — which
is what turns on the tile's per-user `LATERAL` join and `user_fully_ridden_routes`,
the most expensive part of the query.

**Already answered, from the desk:**

- Production tiles are live over HTTPS and Martin's catalog lists all six tile
  functions — so the plan's "tiles are already fine" holds at the transport level.
- **A z4 route tile is 789 KB** of protobuf
  (`/tiles/railway_routes_tile/4/8/5`). That is the number question 2 is really
  about.
- The ported styling typechecks against the same style spec the web app uses (see
  the corrections above).

**Answered on the device** (physical iPhone, Xcode 26.6, iOS 26):

| Question | Answer |
| --- | --- |
| Route tiles load over HTTPS at all? Any `onDidFailLoadingMap`? | **Yes, they load and render.** No `onDidFailLoadingMap`. The z4 tile (789 KB, ~5000 routes) parses and draws. |
| Does it look like the web app — same colours, same relative line weights? | **Yes**, once the colour expression was restructured (below). Visit-status colouring via `?user_id=1` arrives correctly: green / dark green / orange / red / dark red as on the web. |
| Station labels in bold Noto, or a substituted system font? | **Bold Noto** — the glyph path works, no substitution. |
| Japan: place names in **Latin script** (the `latinizeLabels` port) or kanji? | *not yet checked* |
| Heritage layer renders as round dots? Special as dashes? | *not yet checked* (bisect levels 11 and 12) |
| Europe z4, panning: fps with `routes` off / on | *not yet measured* |
| Europe z8, panning: fps with `routes` off / on | *not yet measured* |
| Japan z6, panning: fps with `routes` off / on | *not yet measured* |
| Pinch-zoom fps with `routes` on | *not yet measured* |
| Does `my rides` visibly slow the first paint? | *not yet measured* |
| Subjective with the meter off: smooth / acceptable / bad | *not yet judged* |
| Android (emulator only — tiles/expressions/glyphs, **not** fps) | *not yet run* |
| Anything that surprised you | **Three things.** (1) The binding's `std::bad_alloc` on spec-valid expressions — see below. (2) MapLibre Native logs `Invalid geometry in line layer` against our route tile; GL JS never mentions it. (3) The setup friction was the bulk of the effort — see "Getting it to run". |

**What is confirmed, and it is the important half.** The two questions Phase 0
existed to answer both came back positive: the tile server behaves against the
native SDK, and the styling port is real — `style.ts`, `userRouteStyling.ts` and
`basemap.ts` all produced the web app's own appearance on the phone, including
the four basemap transforms, the fade layer, the station dots and our own station
labels. The camera (flat `LngLatBounds` and all) and the event handlers work,
`onDidFinishRenderingFrame` included — [issue #1165](https://github.com/maplibre/maplibre-react-native/issues/1165)
reports that one broken under Fabric on Android, and it is fine on iOS with the
New Architecture on.

**What is still unknown is the frame rate**, which was question 2's actual
number. Everything above is correctness. Measure it at bisect level 7 (real tile,
constant colour) or with the restructured expression in place; the ladder in
`mobile-spike/App.tsx` is still wired up and documented in its own comments.

#### The colour expression — the one thing that had to change

`getUserRouteColorExpression()` as the web app wrote it **kills the app on
iOS**: `std::bad_alloc`, thrown at `layer.lineColor = styleValue.mlnStyleValue`,
i.e. inside the binding's conversion of the expression to a native style value.
It is not the renderer, not the tile, and not feature count — a high start zoom
with few features on screen dies just as fast.

Bisecting the expression (variants 1–11 in the spike, each documented there)
isolates the trigger to **an `["all", ...]` condition inside a `case` that has
more than one branch**:

| Shape | Result |
| --- | --- |
| `all` condition, one branch | works |
| simple conditions, two branches | works |
| `match`, three branches | works |
| **`all` condition + a second branch** | **`std::bad_alloc`** |

The fix needs no `all`, because the three-state visit logic is the same thing as
single-condition nesting:

```
case  all(has date, whole) → visited        case  has date → (case whole → visited : partial)
      has date            → partial   ==>                 → unvisited
                          → unvisited
```

`match` replaces the `line_class` chain at each leaf. **This shape works on both
platforms**, so the web app now uses it too (`userRouteStyling.ts` and
`lineClassColorExpression`) rather than keeping a native-only variant — one
implementation, and Phase 3 inherits it working. See "Route colours" in
`CLAUDE.md`.

Worth filing upstream: spec-valid input, silent process death, no crash report,
and a two-line reproduction.

#### Getting it to run

Most of the effort was not the map. Recorded because the next person pays it too:

- **npm nests `expo`'s own sub-dependencies** (`expo-asset`, `@expo/log-box`, …)
  under `node_modules/expo/node_modules/` rather than hoisting them, and the
  spike's `disableHierarchicalLookup: true` blocked Metro from looking there —
  so the bundler could not resolve them. That setting was there to stop Metro
  walking *up* into the Next.js repo's conflicting React; it is now a `blockList`
  on the parent `node_modules` alone, which is narrow enough to leave nested
  resolution intact. See the comment in `mobile-spike/metro.config.js`.
- **iOS fetches the JS bundle over Wi-Fi even when the phone is tethered by
  cable.** USB carries the install and the debugger, not Metro; there is no
  `adb reverse` equivalent. Different Wi-Fi networks means `ECONNREFUSED` and a
  white screen, and it bit twice.
- **A silent launch death leaves no crash report.** Console.app's device log
  showed only red herrings (a `UIScene` lifecycle deprecation fault — a warning
  on Xcode 26.6, enforced only against the iOS 27 SDK per
  [expo/expo#46663](https://github.com/expo/expo/issues/46663); sandbox
  `vfs.disk-space` denials; a refused connection to React DevTools on 8097).
  **Running from Xcode with the debugger attached named the exception in
  seconds.** Do that first next time.
- `NSLocalNetworkUsageDescription` / `NSBonjourServices` were missing from the
  generated `Info.plist`; added via `app.json`'s `ios.infoPlist` so they survive
  `expo prebuild`. Not the cause of anything here, but correct to have.

**Decision: not yet taken.** Correctness is proven and the one blocker is
understood and fixed. The go / no-go still wants the fps numbers, since "does a
5000-route tile render at an acceptable frame rate on a phone" is the question
that decides whether Phases 3 and 5 are worth their weeks. Nothing found so far
argues against continuing.

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

### You have a Mac, so use it

This section originally argued that iOS shipping is possible from Windows alone
via **EAS Build** (cloud compilation) and **EAS Submit**. That remains true and is
worth keeping as the fallback — but it is no longer the plan, because a Mac is
available. Building locally with Xcode is faster than round-tripping to a cloud
builder and costs nothing.

- **Development builds are mandatory, not optional.** `@maplibre/maplibre-react-native`
  ships native code and is not part of the Expo SDK, so **Expo Go cannot run this
  app** at any point in the project. Every device run is `expo run:ios` /
  `expo run:android` (or an EAS build). Plan the tooling setup accordingly — see
  `mobile-spike/README.md`, which has the from-scratch Xcode/CocoaPods steps.
- Testing on your own iPhone needs only a **free** Apple ID in Xcode; its
  provisioning profiles expire after 7 days, which is fine for development. The
  $99/year Apple Developer Program is for TestFlight and the store, i.e. Phase 6.
- The **iOS Simulator** works and is fine for correctness, but it renders on the
  Mac's GPU — **any frame-rate number from it is meaningless.** Same for the
  Android emulator. Performance questions need real hardware, which for Android
  means acquiring a device.
- If you do fall back to EAS: cloud builds are minutes each and metered on the
  free tier, so budget for either patience or a paid tier during Phases 3 and 5.

### Per platform

| | iOS | Android |
| --- | --- | --- |
| Developer account | Apple Developer Program, **$99/year** (Phase 6 only) | Google Play, **$25 one-time** |
| Build | locally on the Mac with Xcode; EAS Build as fallback | EAS Build, or locally with Android Studio |
| Testing | iPhone available ✓ (Simulator for correctness only) | **no device yet** — emulator only, so fps unmeasurable |
| Review | slower, stricter; expect a rejection round | faster, laxer |
| Store paperwork | screenshots at several sizes, privacy manifest, privacy policy URL | data safety form, target-API-level requirements |

Both stores need a privacy policy URL and an account-deletion path if the app has
accounts — which this one does.

### Also needed

- A physical **Android device** — the one hardware gap. The iPhone is covered.
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

---

## Session log

Newest last. One line per session: what moved, and what the next session should
pick up. Keep it short — the phase sections carry the detail.

- **2026-08-27** — Started the project. Verified the library landscape against
  the real packages (`@maplibre/maplibre-react-native` 11.3.7, Expo SDK 57) and
  corrected five wrong assumptions in this plan, the `localizeLabels` one being
  the consequential one. Built the Phase 0 spike in `mobile-spike/`; it
  typechecks but has never been run. Added the `tsconfig`/`biome` exclusions it
  requires. **Next:** run it on the iPhone from the Mac, fill in the Phase 0
  findings table, decide go / no-go. Nothing has been built or run on a device
  yet, so any Phase 0 answer below that is still blank is genuinely unknown —
  don't infer one from the fact that the code typechecks.
- **2026-08-27 (later)** — Ran the spike on a physical iPhone. **Tiles and
  styling both confirmed working**, including the 789 KB z4 tile, the basemap
  transforms, the glyph path and our station labels. Found and fixed the one
  blocker: the binding throws `std::bad_alloc` converting a `case` that carries
  an `["all", ...]` condition alongside a second branch, which is exactly the
  shape of `getUserRouteColorExpression()`. Restructured it to single-condition
  nesting plus `match`, **applied to the web app too** so both platforms share
  one shape. Fixed the spike's Metro resolver (`blockList` instead of
  `disableHierarchicalLookup`) and added the local-network `Info.plist` keys.
  **Next:** the remaining device answers — fps at Europe z4/z8 and Japan z6,
  Japan's Latin labels, heritage dots and special dashes (bisect levels 11–12),
  then Android on the emulator for correctness only. The bisect ladder in
  `mobile-spike/App.tsx` is still in place; set `BISECT_LEVEL = 12` and
  `COLOR_VARIANT = 11` for the full stack, or delete the gating once done. After
  that, take the go / no-go.
