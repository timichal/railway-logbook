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

|                   |                                                                                                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Branch**        | `mobile-app` — all of this work lives here, not on `main`                                                                                                                                                                                                                   |
| **Phase 0**       | **Done. Decision taken: GO** (2026-08-27). Both headline questions answered positively on real hardware                                                                                                                                                                     |
| **Phase 1**       | **Done** (2026-08-27). 23 route handlers under `/api/v1`, smoke-tested against the dev database. Reference: `API.md`                                                                                                                                                        |
| **Phase 2**       | **Done** (2026-08-27). The Expo app is in `mobile/` — auth, region, theme, tabs. Runs on iOS and signing in works; not yet run on Android                                                                                                                                   |
| **Phase 3**       | **Done** (2026-08-27; **seen on a device 2026-09-17**). Basemap, the full railway layer stack, visit colours, filters, stations and labels, tap-to-inspect, the progress box. Its **highlight overlay** was folded into Phase 4 and is now done; the coverage overlay is not |
| **Current phase** | **Phase 4 — features.** Route logger, highlight overlays and the logbook list are built (2026-09-17); planner, country stats, station search and the coverage overlay are not |
| **Blocked on**    | nothing                                                                                                                                                                                                                                                                     |
| **Next**          | The journey planner, country stats and station search, and the coverage overlay (`GET /coverage` already exists; an earlier note here saying otherwise was wrong). Plus a pass over the UI details of what is already built |

The spike that answered Phase 0 has been **deleted** — it was throwaway by design
and everything it taught is written down below. What it proved, in one line: the
tile server behaves against MapLibre Native, the styling ports, and a 5000-route
z4 tile pans smoothly on an iPhone.

---

## What Phase 0 established

Verified against the real packages — `@maplibre/maplibre-react-native` **11.3.7**,
Expo SDK **57**, RN **0.86** — on a physical iPhone (Xcode 26.6, iOS 26) and an
Android emulator. **Several of these corrected assumptions this plan originally
made**, so treat them as facts rather than as notes.

### The answers

| Question                                                | Answer                                                                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route tiles over HTTPS against the native SDK           | **Yes.** No `onDidFailLoadingMap`. The z4 Europe tile — 789 KB of protobuf, ~5000 routes — fetches, parses and draws                                                                                                      |
| Does it look like the web app?                          | **Yes.** Same colours, same relative line weights. Visit-status colouring via `?user_id=1` arrives correctly                                                                                                              |
| Station labels: bold Noto or a substituted system font? | **Bold Noto.** The glyph path works                                                                                                                                                                                       |
| Japan: Latin script or kanji?                           | **Latin** — the `latinizeLabels` port does it. Native does *not* do this for free (see below)                                                                                                                             |
| Heritage as round dots, Special as dashes?              | **Both render.** The zero-length `[0, 3]` dash plus a round cap gives dots on native as in GL JS. They read a little alike — a Phase 3 styling question, not a rendering one                                              |
| Does the per-user tile join slow the first paint?       | **No, effectively instant** — including `user_fully_ridden_routes`, the expensive half of the query                                                                                                                       |
| Frame rate, Europe z4, panning                          | **Smooth subjectively** — "not exactly 60, but fine" — at full zoom-out with the whole route stack on. Never captured as a *number*: the spike's meter was counting the wrong frames (see below) and the project moved on |
| Android                                                 | **Works** on an arm64 emulator, API 34+ — tiles load, expressions parse, the map renders. Its fps is meaningless (it renders on the Mac's GPU and is slow at everything)                                                  |

Both regions behave, so **shipping Europe and Japan both is confirmed nearly
free** — that was an open decision and it is now closed.

### Facts about the binding that the port depends on

- **Expo Go cannot run this app, ever.** The binding ships native code and is not
  part of the Expo SDK, so every device run is a development build
  (`expo run:ios` / `expo run:android`) with the config plugin in `app.json`.
  This is the single biggest practical difference from ordinary Expo work.
- **The v11 component names differ from the docs you will find.** `<MapView>` is
  `<Map>`; the pieces are `<Map mapStyle>`, `<Camera initialViewState>`,
  `<VectorSource tiles>`, `<Layer type source-layer paint layout>`.
- **`LngLatBounds` is flat `[west, south, east, north]`**, not the web app's
  nested `[[w, s], [e, n]]`. A silent porting trap in `regions.ts`.
- **`localizeLabels` does not exist here.** That is rnmapbox's prop, and this plan
  wrongly claimed native "exposes label localization on the MapView directly". So
  `latinizeLabels` **does** carry over, which is what makes Japan readable. It
  works because `mapStyle` accepts `string | StyleSpecification`: fetch the style,
  run the same transforms the web app runs, hand over the object.
- **The styling ports better than "nearly verbatim".** `<Layer>`'s props *are*
  `LayerSpecification` (with `id`/`source` optional, plus
  `beforeId`/`afterId`/`layerIndex` — so the web app's `moveLayer` ordering has a
  declarative equivalent). The binding depends on
  `@maplibre/maplibre-gl-style-spec`, the same package `maplibre-gl`'s types come
  from, so the port can be properly typed rather than loosely. **But not
  automatically the identical `ExpressionSpecification`**, as this said before
  Phase 3 tried it: the two apps resolve two different *copies* of that package
  (26.4.0 via `maplibre-gl`, 24.8.5 pinned by the binding), and the recursive
  expression type from one copy is not assignable to the same type from the other.
  A `paths` entry in `mobile/tsconfig.json` pins the native program to one copy —
  see Phase 3.
- **But typechecking is not running.** The binding throws `std::bad_alloc`
  converting some spec-valid expressions to native style values — see below. No JS
  error, no crash report, nothing `tsc` can catch. **An expression that typechecks
  still has to be run on a device.**
- **`<Camera initialViewState>` is initial and nothing else.** It cannot move the
  camera later, and remounting the Camera does not reset it — this cost the spike
  a debugging session. On iOS it is applied once from `MLRNMapView.layoutSubviews`
  behind a `_pendingInitialLayout` flag, `MLRNCameraComponentView.updateProps`
  guards it with `if (_view.initialViewState == nil)`, and `MLRNCamera.setMap:`
  has both `_setInitialCamera` and `updateCamera` **commented out** — so a new
  Camera attached to an existing map applies neither. What moves the camera is a
  *stop*: the `center` / `zoom` / `bounds` / `duration` props. **Phase 3's region
  switching hangs on this**, since the web app achieves it by rebuilding the map
  and there is nothing to rebuild here.
- **`onDidFinishRenderingFrame` is not "every frame".** The delegate is an
  if/else on `fullyRendered`, so that callback fires *only* for frames still
  awaiting tiles and everything else goes to `onDidFinishRenderingFrameFully`.
  Counting one of them and calling it the frame rate reads ~6 fps against a
  visibly smooth pan. Count both.
- `onDidFinishRenderingFrame` works on iOS under the New Architecture, despite
  [maplibre-react-native#1165](https://github.com/maplibre/maplibre-react-native/issues/1165)
  reporting it broken under Fabric on Android.

### The colour expression — the one thing that changed in the web app

`getUserRouteColorExpression()` as the web app originally wrote it **killed the
app on iOS**: `std::bad_alloc`, thrown at `layer.lineColor =
styleValue.mlnStyleValue`, inside the binding's conversion of the expression to a
native style value. Not the renderer, not the tile, not feature count — a high
start zoom with few features on screen died just as fast.

Bisecting isolated the trigger to **an `["all", ...]` condition inside a `case`
that has more than one branch**:

| Shape                                 | Result               |
| ------------------------------------- | -------------------- |
| `all` condition, one branch           | works                |
| simple conditions, two branches       | works                |
| `match`, three branches               | works                |
| **`all` condition + a second branch** | **`std::bad_alloc`** |

`all` in a *filter* is fine — the scenic layer nests `REGULAR_ONLY_FILTER` inside
one and runs. It is only fatal in a multi-branch `case`.

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
implementation, and Phase 3 inherits it working. See "The colour expression" under
Map styling in `CLAUDE.md`; **keep new data-driven paint expressions in that
shape**.

Worth filing upstream: spec-valid input, silent process death, no crash report,
two-line reproduction.

### `Invalid geometry in line layer` — the basemap's, not ours

MapLibre Native logs this where GL JS says nothing. It is **not** our route tile:
decoding `railway_routes_tile` at z4–z8 for both regions, with and without
`?user_id=1`, every feature is a LineString with ≥2 points. It is liberty's
`park_outline`, an unfiltered `line` layer over OpenMapTiles' `park` source-layer,
which carries a label **point** per park alongside the polygon. Fixed by a fourth
basemap transform, `filterPointsFromParkOutlines`, in the web app — full account
under Basemap in `CLAUDE.md`. Nothing rendered wrong either way. Worth filing
against the liberty style, not against MapLibre Native.

### Getting the tooling to run

Most of Phase 0's effort was not the map. Phase 2 pays this again on a fresh
project, so it is recorded here rather than in the deleted spike.

**iOS, on the Mac:**

1. **Xcode** from the App Store; launch once to accept the licence and install
   components. Then `xcode-select --install`.
2. **CocoaPods**: `brew install cocoapods`. **Node 20+**: `brew install node`.
3. `npx expo run:ios --device`, picking the iPhone. This runs `expo prebuild`,
   generating a gitignored `ios/` — disposable output, not source. First build is
   10–20 minutes.
4. A **free** Apple ID in Xcode → Settings → Accounts is enough for your own
   device; its provisioning profile expires after 7 days.

**Android, on the Mac (Apple Silicon):**

1. `brew install --cask android-studio`, launch once, take the wizard's defaults
   (SDK + platform tools + an image under `~/Library/Android/sdk`).
2. **JDK 17** — `brew install openjdk@17`. **Not** the JDK Android Studio bundles:
   that is now **JDK 25**, and JEP 472 (restricted native access) flipped from warn
   to deny in 25, so AGP's CMake task — which loads a native library — fails the
   build at `:expo-modules-core:configureCMakeDebug` with a message that reads like
   a warning and is fatal (`A restricted method in java.lang.System has been
   called`). It fails ~8 minutes in, so it is an expensive lesson.
3. In `~/.zshrc`, then a new terminal:

   ```bash
   export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
   ```

   `java -version` must say 17.
4. Device Manager → any recent Pixel, API 34+, **arm64-v8a** system image (x86
   emulates and is unusable). Boot it, then `npx expo run:android`.

**Traps that cost real time:**

- **The first *device* build cannot be done by `expo run:ios`.** A simulator build
  needs no provisioning profile, so a project that has only ever run on the simulator
  has none — and Xcode will not create one, or register the phone with the team,
  unless xcodebuild is passed `-allowProvisioningUpdates`, which the Expo CLI has no
  flag to forward (`--scheme`, `--configuration`, `--device`, `--binary`, and nothing
  else). It fails at "Planning build" with `No profiles for '<bundle id>' were found`,
  which reads like a certificate problem and is not — `security find-identity` will
  show a perfectly good one. Do the first device build **from Xcode** (open
  `ios/*.xcworkspace`, ⌘R, starting Metro yourself in `mobile/` since Xcode will not),
  or once from the CLI with the flag:

  ```bash
  xcodebuild -workspace RailwayLogbook.xcworkspace -scheme RailwayLogbook \
    -configuration Debug -destination "id=<device udid>" -allowProvisioningUpdates
  ```

  `npm run ios` works normally afterwards. One reading trap on the way: the team id in
  `security find-identity`'s output is the **OU** of the certificate, not the
  parenthesised id in its common name — the latter looks like a team id and is not one.

- **iOS fetches the JS bundle over Wi-Fi even when the phone is cabled.** USB
  carries the install and the debugger, not Metro, and there is no `adb reverse`
  equivalent. A phone on a different Wi-Fi network means `ECONNREFUSED` and a
  white screen. Android does not have this problem — `expo run:android` sets up
  `adb reverse`.
- **A silent launch death leaves no crash report.** Console.app's device log
  showed only red herrings (a `UIScene` deprecation fault — a warning on Xcode
  26.6, enforced only against the iOS 27 SDK per
  [expo/expo#46663](https://github.com/expo/expo/issues/46663); sandbox
  `vfs.disk-space` denials; a refused React DevTools connection on 8097).
  **Running from Xcode with the debugger attached named the exception in
  seconds.** Do that first.
- **Metro resolution inside this repo.** An RN project living in this repo must
  stop Metro walking *up* into the Next.js `node_modules` and its different React.
  Use a **`blockList` on the parent `node_modules` only** —
  `disableHierarchicalLookup: true` is too blunt, because npm nests `expo`'s own
  sub-dependencies (`expo-asset`, `@expo/log-box`, …) under
  `node_modules/expo/node_modules/` rather than hoisting them, and disabling
  hierarchical lookup stops the bundler resolving those too.
- **`tsconfig.json` must exclude the RN directory.** The root `include` is
  `**/*.ts`, so otherwise React Native's global `setTimeout` declaration leaks into
  the web app's program and breaks `JourneyPlanner.tsx` and `useStationSearch.ts`
  with `Type 'number' is not assignable to type 'Timeout'`. **`biome.json` should
  exclude it too** — different toolchain, and the `next` lint domain has nothing
  useful to say about RN code.
- **`NSLocalNetworkUsageDescription` / `NSBonjourServices`** belong in `app.json`'s
  `ios.infoPlist` so they survive `expo prebuild`.
- **`userInterfaceStyle` needs `expo-system-ui` on Android**, or the setting is
  silently ignored there. The app has a Light/System/Dark setting, so install it.

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

The split is sharper than it looks, and it is favourable. Phase 0 confirmed the
"ports nearly verbatim" column by actually running it.

### Ports nearly verbatim

Plain data, style objects, or pure logic — no DOM, no browser:

- `src/lib/map/style.ts` — `COLORS`, `WIDTHS`, `CIRCLES`, `LABELS`, `OPACITIES`.
  The single source of truth stays the single source of truth.
- `src/lib/map/userMapLayers.ts` — the layer stack and paint configs. Same JSON
  and the same *types* on native (see the binding facts above).
- `src/lib/map/utils/userRouteStyling.ts`, `src/lib/map/utils/distance.ts`.
- `src/lib/regions.ts`, `routeCoverage.ts`, `constants.ts`, `types.ts`,
  `countryUtils.ts`, `coordinateUtils.ts`. One trap in `regions.ts`: the
  binding's `LngLatBounds` is flat, so `bounds` needs converting.
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
  is what the coverage overlay's repeated `moveLayer` becomes. **The camera is the
  exception to "declarative is easier"** — see the `initialViewState` trap above.
- **`src/lib/map/interactions/userMapInteractions.ts`** — `map.on("click")` plus
  `queryRenderedFeatures` becomes `onPress` on the individual layers. Mostly a
  simplification: the station-wins-over-route special case exists because the web
  click handler is map-wide, and per-layer `onPress` makes it unnecessary. The
  whole touch-sheet apparatus (`sheetTookThisClick`, the grace window, the
  anchor arithmetic) exists to work around a browser synthesizing mouse events
  from taps, and has no reason to be ported at all.
- **`src/lib/map/utils/tooltipFormatting.ts`** — popups become RN components, so
  the HTML-string machinery goes away entirely and `escapeHtml` with it. Keep
  `safeHref`'s http(s) check, though: it still guards `Linking.openURL` against
  a route link edited by a third party.
- **`basemap.ts`** — ports almost entirely, and more of it than first thought. All
  five transforms (POI drop, buildings flattening, Latin labels, park-outline
  point filter, fade layer) apply to a fetched style object which is then handed to
  `<Map mapStyle>`. Confirmed working, Latin labels included.
- **The whole component tree.** No DOM, no CSS. **NativeWind** gives you Tailwind
  class names in RN, which makes this mostly transcription rather than redesign —
  and the web app's mobile decisions (bottom sheet, tap-to-inspect, 44pt targets;
  all documented under **UI structure** in `CLAUDE.md`) are the ones you build here
  from the start.

### The data layer — was the hard blocker, now solved

**The entire data layer was server actions, and React Native cannot call them.**
Phase 1 fixed that: every user-scoped query now lives in a plain module taking a
`userId`, and three callers resolve *which* user — a server action from the
cookie, `publicMapActions` from a share token, a route handler from a bearer
token. `API.md` is the endpoint reference; the web app is unchanged.

### Tiles are already fine

Production serves Martin through nginx at `/tiles` over HTTPS
(`docker-compose.yml` exposes Martin on 3001; `getTileBaseUrl()` in
`src/lib/map/index.ts` builds the public URL). Both platforms block cleartext HTTP
by default — iOS App Transport Security, Android since 9 — so HTTPS is required,
and you already have it. **Proven end to end in Phase 0.**

One change: `getTileBaseUrl()` derives the host from `window.location`. In RN
there is no `window.location`; this becomes a build-time config constant per
environment. **Done in Phase 3**, and the shape it took matters: the source
factories moved into `map/tileSources.ts` and take the host as an argument, so
`map/index.ts` binds the web app's and `mobile/src/map/tileUrls.ts` binds the
app's, with one copy of the URL templates between them.

---

## Phases

Estimates assume **part-time work** (evenings and weekends) by someone strong in
JS/React and new to RN, vibe-coding with an assistant. Full-time, halve them.

### Phase 0 — Spike — **DONE, decision GO**

Everything it established is in "What Phase 0 established" above; the
`mobile-spike/` directory has been deleted as designed.

### Phase 1 — HTTP API layer — **DONE**

23 route handlers under `src/app/api/v1`, in front of the query modules the app
needs. **`API.md` is the reference** — endpoints, request and response shapes,
and the rules that apply to all of them. What follows is only what a future
session needs to know about *why* it looks like this.

**The shape, as planned: handler resolves auth → calls a query module.** The
queries were lifted out of the `"use server"` modules into plain ones taking a
`userId`, following `progressQueries.ts`: `journeyQueries.ts`, `tripQueries.ts`,
`preferencesQueries.ts`, plus the user-less `routeQueries.ts`, `authQueries.ts`
and `routePathFinder.ts` (which stopped being `"use server"` — `plannerActions.ts`
is now the web's one-line way in). The `*Actions.ts` modules kept their exact
export signatures, so **not one component changed**, which is what made the web
app usable as the regression test. A handler importing an action is the one thing
that must not creep back in; the reason is in `progressQueries.ts`'s header.

**Auth.** `authTokens.ts` holds the JWT work for both transports, `authQueries.ts`
the bcrypt work, and `authActions.ts` is now only the cookie. The app gets an
**access token (7d) plus a refresh token (180d)**, swapped as a pair at
`POST /auth/refresh` — the plan asked for a refresh story because being logged
out on a train is worse than useless, and 180 days is sized for a logbook that
gets opened when a trip happens. Tokens are stateless: no revocation, **no logout
endpoint**, logging out is the client dropping both. A cookie session token also
verifies as an access token (same secret, same claims), which is convenient for
poking at the API from a browser; a refresh token never does.

**Error taxonomy, which was the one thing the plan didn't foresee.** Query
modules report failure two different ways, and both had to reach HTTP correctly:
an in-band `{ error: "…" }` (what the journey and trip modules return, because
the web callers render it) is mapped by `statusForMessage` — "not found" → 404,
"Failed to …" → 500, anything else → 400. Thrown failures needed a distinction
that did not exist: a rejected password is for the user, a Postgres error is not.
`ValidationError` (`src/lib/errors.ts`) is that line — 400 with its message,
while a plain exception is logged and returned as an opaque 500. Found by the
smoke test, which had `register` with a short password coming back as a 500.

**Region scoping** is an explicit `?region=` and a 400 when it is missing —
never a default, since a missing region is a query answering for the other
continent.

**What was left out**, all deliberately: admin (single-user, web-only, would
roughly double the layer), `migrationActions` (web-only by nature), and the
shared-map endpoints, which stay an open decision below — the queries are already
shared, so they are an afternoon whenever the app decides to open those links.

**Verified against the dev database**, not just typechecked: every endpoint, the
region guard, the auth failures, and a full write lifecycle (create a trip and a
journey → assign → flip `partial` → add and remove routes → delete both → 404),
which also confirmed a `covered` fraction range round-trips. The planner endpoint
returns exactly what `npm run inspectPath` does for the same pair (Praha hl.n. →
Kolín: 4 routes, 62.2 km, same ids). `/routes?region=europe` is 5530 routes in
~1.9s — the one call worth caching on the device rather than repeating.

One thing to know for Phase 2: a **station id can be negative**. An OSM area
station is stored under a negated id, so `fromStationId` is validated as non-zero
rather than positive.


### Phase 2 — App shell — **DONE**

The Expo app lives in **`mobile/`**: expo-router navigation, login and register
against the API, the token pair in the keychain, the region switch, and a
Light/System/Dark setting. No map — that is Phase 3, and the Map tab shows this
region's progress numbers instead, which is what proves the shell works end to
end: a bearer token, a region parameter and a real answer from production.

**It is a separate npm project, not a workspace.** Its own `package.json` and
`node_modules` one level down from a Next.js app that pins a different React. A
workspace would hoist the two into one tree, which is the thing to avoid.

#### Shared code: `@shared/*` → `../src/lib/*`

The app imports the web app's modules directly rather than copying them, so
`style.ts` stays the single source of truth that "Ports nearly verbatim" above
assumes. Two pieces make it work, and both are load-bearing:

- **`metro.config.js`** adds `src/lib` to `watchFolders` (Metro will not read a
  file outside the project root otherwise) and blocks **exactly one** directory:
  the parent `node_modules`. Blocking it is what stops Metro resolving the web
  app's React; blocking it *specifically*, rather than setting
  `disableHierarchicalLookup`, is what keeps expo's own nested
  sub-dependencies resolvable — the trap recorded under "Getting the tooling to
  run".
- **`tsconfig.json`** maps `@shared/*` to `../src/lib/*`, and the web app's
  `tsconfig.json` now **excludes `mobile`** so React Native's globals stay out of
  its program — the leak the Phase 0 notes predicted, and the reason `tsc` is two
  runs rather than one.

**What may be imported is decided by dependencies, not by intent.** A module that
reaches `pg` is server-only however plain it looks — which is why the API response
types are declared in `src/api/endpoints.ts` rather than imported from
`progressQueries.ts`, where `UserProgress` actually lives. `regions.ts`,
`constants.ts` and `types.ts` are dependency-free and cross over untouched;
`regionCountryCodes` is already shared, so the app filters its progress by the
same rule `RailwayMap` uses (stored preference where the region allows a country
filter, the region's own list where it does not).

#### The shape of it

|                                |                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config.ts`                | `API_BASE_URL` and `TILE_BASE_URL`, both derived from one origin. Defaults to **production over HTTPS**, overridable at bundle time with `EXPO_PUBLIC_API_ORIGIN`. This is what replaces `getTileBaseUrl()`'s `window.location` |
| `src/auth/tokenStore.ts`       | the pair in `expo-secure-store`, cached in memory so the keychain is off the request path                                                                                                                                       |
| `src/api/client.ts`            | bearer header, error mapping, and the refresh dance                                                                                                                                                                             |
| `src/auth/AuthContext.tsx`     | `loading` / `signedOut` / `signedIn`, settled at cold start by `GET /auth/me`                                                                                                                                                   |
| `src/region/RegionContext.tsx` | the region in `AsyncStorage`, hydrated before the first render                                                                                                                                                                  |
| `src/theme/ThemeContext.tsx`   | Light/System/Dark via NativeWind's `colorScheme` plus `expo-system-ui`                                                                                                                                                          |
| `src/ui/`                      | `Button`, `TextField`, `SegmentedControl`, `Screen` — a class per *role*, as `buttonStyles.ts` is on the web                                                                                                                    |
| `app/`                         | `index` (the fallback route), `(auth)/login`, `(auth)/register`, `(tabs)/map`, `(tabs)/logbook`, `(tabs)/settings`                                                                                                              |

Three decisions worth not re-deriving:

- **The refresh is single-flight.** Three requests firing at once on a cold start
  would otherwise send three refreshes, and since each one issues a *new* pair,
  the last write would win and the other two replies would be discarded — leaving
  tokens in the keychain that no response ever confirmed.
- **A failed refresh is not the calling screen's problem.** The client reports it
  through `onSignedOut`, which the auth context registers, rather than throwing a
  401 at whichever screen happened to ask.
- **Routing is `Stack.Protected` plus an unguarded `index`.** The two trees are
  declared side by side and the guard decides which exists, so no screen redirects
  on mount and no protected screen is ever briefly mounted. `index` exists
  unguarded because signing out removes the `(tabs)` group from under the router:
  it lands on `index`, which sends it to `/login`.

#### Tooling traps, all new since Phase 0

- **`create-expo-app` is broken under npm 12.** It shells out to
  `npm pack --dry-run` and cannot parse what npm 12 prints back. Fetch the
  template tarball from the registry and extract it — that is all the tool does.
- **`react-dom` needs pinning.** `expo-router` pulls `vaul` → Radix, which
  peer-depends on `react-dom`; npm resolves the newest, whose own peer demands a
  `react` newer than the one Expo pins, and *every* subsequent `npm install`
  fails `ERESOLVE`. `"overrides": { "react-dom": "19.2.3" }` in
  `mobile/package.json` matches it to Expo's `react`. Nothing native imports
  react-dom; it is there for expo-router's web path.
- **`babel-preset-expo` must be an explicit devDependency.** npm nests it under
  `node_modules/expo/node_modules/`, and Babel resolves preset *names* relative
  to `babel.config.js`, so a hand-written config cannot see it. The failure is
  `Cannot find module 'babel-preset-expo'` from the Metro transformer, which
  reads like a broken install and is not.
- **npm 12 blocks install scripts.** `fsevents` is approved in `allowScripts`;
  without it Metro's file watching falls back to polling.
- **CocoaPods is a gem, not a brew formula here.** Its binary lives in
  `/opt/homebrew/lib/ruby/gems/*/bin`, which a non-login shell does not have on
  `PATH` — `expo run:ios` then fails at `pod install`.

#### Linting

`mobile/biome.json` is a **nested config** (`"root": false`), not the separate one
the Phase 0 notes assumed. Biome 2 refuses to sit beside a second *root* config —
excluding `mobile/**` from the root config and giving it its own made
`npm run lint` fail at the repo root with "Found a nested root configuration".
Nesting is what it is built for instead: the root run walks the whole repo and
applies this config to everything under `mobile/`, which is what keeps the `next`
lint domain away from RN code and gives `global.css` its exception (the Tailwind 3
`@tailwind` directives are not the v4 syntax the root's `tailwindDirectives`
knows). It runs off the **root's** Biome binary, so `npm run lint` from either
directory covers this code, with one copy of Biome and one formatting style.

#### Icons

`npm run generateAppIcons` now also writes `mobile/assets/` — `icon.png` at 1024,
`adaptive-icon.png` in the maskable framing (a launcher crops Android's foreground
layer exactly as the web manifest's maskable icon is cropped), and a transparent
`splash-icon.png`, since Expo composites that one onto a background colour that
differs between light and dark. One master, one script; the native app has no
artwork of its own.

#### Verified

`npm run lint` and `npm run typecheck` clean in `mobile/`, and both still clean at
the repo root. `npx expo export --platform ios` bundles, which is what proves the
Metro wiring — and a grep of the non-bytecode bundle for `hasScenicHighlight`
proves `@shared` really resolves into `../src/lib` rather than silently resolving
somewhere else.

Then **built and ran on the iOS simulator**: prebuild, CocoaPods and the config
plugins applied, the app launched, and the router landed on `/login` — which is
the whole cold-start chain working (keychain read → no tokens → `signedOut` →
unguarded `index` → redirect). NativeWind renders, and flipping the simulator to
dark mode flips the whole tree, so the theme wiring is confirmed on the "system"
default. Production already serves `/api/v1`, so the shell talks to real data.

One thing that fixing needed a device to find: **`className` on expo-router's
`Link` does not reach the `Text` it renders** — the link was drawn in the default
colour with the class silently ignored. Both auth screens now put a styled `Text`
inside the `Link` instead. Worth remembering as a class of bug: a component that
merely *accepts* `className` in its types has not necessarily applied it.

**Signing in works** — confirmed by hand on iOS, which is the whole of the rest of
the chain: the token pair into the keychain, `Stack.Protected` swapping to the tab
tree, and the progress request answering with a bearer token against production.

**Android has not been run.** Nothing suggests it won't (Phase 0 ran the map
itself on an emulator), but the shell has not been on it — and `expo-system-ui` is
installed precisely because `userInterfaceStyle` is otherwise ignored there, which
is the one thing worth looking at first.

Two notes for whoever runs it: Metro must not be started with `CI=1` (it disables
watch, and an edit then silently serves the old bundle — which cost a confusing
round here), and on a physical iPhone the phone must be on the same Wi-Fi as the
Mac, per "Getting the tooling to run".

### Phase 3 — The map — **mostly done**

The map is on screen: the basemap with all five of its transforms, the whole
railway layer stack, visit-status colouring, the country and usage-type filters,
station dots and labels, tap-to-inspect, and the region's numbers over one
corner. What is left is the two **overlays** — see "Still open" below — and they
are left deliberately, because both are driven by state that arrives with Phase
4.

#### The shared modules — the part that took the thinking

Phase 2 chose to import the web app's `src/lib` rather than copy it, so that
`style.ts` would stay one source of truth. Phase 3 is where that promise was
paid, and it needed a refactor **on the web side** before any of it could be
imported. Three things blocked it, and the fixes are now invariants (they are
written up under "`mobile/` is a second app" in `CLAUDE.md`):

- **The tile host.** `map/index.ts` computed it from `window.location` at module
  load, which in React Native is a `window` with no `location` — so importing
  that module at all was fatal, not merely wrong. The source factories moved to
  `map/tileSources.ts` and **take the host as their first argument**; `index.ts`
  re-exports them with the web's host bound in, so not one web call site
  changed. The alternative — writing the URL templates twice — would have
  duplicated the `selected_countries` JSON encoding, which is exactly the kind of
  contract that drifts silently.
- **`maplibre-gl` types.** Every shared module now imports its spec types from
  `@maplibre/maplibre-gl-style-spec` (a types-only dependency of the web app, the
  binding's runtime dependency), because a layer specification and a `<Layer>`'s
  props are then literally the same type and a spec spreads into a component.
- **The `@/*` alias.** It means `src/*` in one app and `mobile/src/*` in the
  other, so a shared module may use **relative imports only**. This is what moved
  `resolveMissingBasemapIcons` out of `basemap.ts` (`missingIcons.ts`, web-only:
  it is the one piece there that needs a live `maplibregl.Map`) and what points
  the theme imports at `theme/types.ts` rather than the `"use client"` barrel.

Two pieces of logic were *lifted into* the shared set on the way, rather than
reimplemented on the native side: `scenicOutlineFilter` / `clickBufferFilter` in
`userMapLayers.ts` (what the layer toggles do to the filters — one decision, two
mechanisms) and `map/routeFeature.ts` (`routeTitle`, `routeBadges`,
`parseFrequencyTags` — what a route feature *says*, so the popup and the sheet
render the same decisions rather than agreeing by coincidence). Both mean the web
app changed too; `npm run lint` and `npx tsc --noEmit` at the root are what stands
behind that.

#### The native side

`mobile/src/map/` is nine files, and none of them re-states a colour, a width, a
dash pattern or a zoom range.

|                         |                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `RailwayMap.tsx`        | the map. `<Map>`, `<Camera>`, three `<VectorSource>`s, and the shared layer specs spread into `<Layer>`                                         |
| `useBasemapStyle.ts`    | `loadBasemapStyle` for the resolved scheme, plus `version: 8`, the glyph endpoint and the fade layer; the raster fallback when it resolves null |
| `tileUrls.ts`           | the shared URL templates with this build's host bound in — the native half of what `index.ts` does for the web                                  |
| `LayerPrefsContext.tsx` | the three toggles in `AsyncStorage`, held above the map because the switches live in Settings                                                   |
| `LayerToggles.tsx`      | those switches, with the region rules (Japan renames Special, offers no scenic outline)                                                         |
| `mapPosition.ts`        | one saved camera position per region                                                                                                            |
| `mapFeatures.ts`        | what a press hit, read defensively off an MVT feature. `safeUrl` is `safeHref` minus the HTML escaping                                          |
| `FeatureSheet.tsx`      | the route / station / note body as a bottom sheet                                                                                               |
| `MapProgressBox.tsx`    | the percentage pill that expands to the numbers                                                                                                 |

**Layers are children, not a baked style.** `mapStyle` carries the basemap and
nothing of ours; our sources and layers are JSX, so a layer toggle is a
re-render rather than a style rebuild — and children are appended above whatever
the style already had, which is the same order `useMapLibre` assembles by hand.
The fade layer is the exception and stays in the style, as the last of the
basemap's own layers and therefore under every child.

**A toggle is a mounted child, not a `visibility` property.** The three optional
layers come out of the shared factories with `visibility: "none"`, because that
is the state the web app's imperative toggles expect; here the layer is simply not
rendered when it is off, and `shown()` undoes that default when it is on.

**The click-buffer layer has no counterpart, and needs none.** A press arrives
through each `<VectorSource>`'s own `onPress` with a 44×44pt hitbox, and the
topmost layer within it wins — which is the note-beats-station-beats-route
precedence the web app hand-codes with `queryRenderedFeatures`, for free. The
whole touch-sheet apparatus (`sheetTookThisClick`, the grace window, the anchor
arithmetic) ported to nothing, as predicted: it exists to stop a browser's
synthesized mouse events from fighting a tap, and there are none here. A source
handler calls `stopPropagation()` so the press that opens the sheet is not also
the map press that dismisses it.

**The camera is where Phase 0's warning earned its keep.** `initialViewState` is
applied once from the map's first layout and cannot be revisited, so the saved
position is read *before* the map mounts (the map renders a spinner until both it
and the basemap style are in hand) and a region switch moves the camera with
`cameraRef.setStop({ duration: 0 })`. `maxBounds` is a `<Camera>` prop and changes
with the region — flat `[w, s, e, n]`, where `region.bounds` is nested.

#### New traps, all found by typechecking or building rather than by running

- **Two copies of `@maplibre/maplibre-gl-style-spec` do not typecheck against
  each other.** The web app resolves 26.4.0 (via `maplibre-gl`), the binding pins
  24.8.5, and a shared module compiled into the native program picks up the web
  app's copy by ordinary node resolution — at which point
  `ExpressionSpecification` from one copy is not assignable to
  `ExpressionSpecification` from the other. The error is a wall of "not
  assignable to itself" on a recursive type and says nothing about versions. Fixed
  with a `paths` entry in `mobile/tsconfig.json` mapping the specifier to
  `mobile/node_modules`, so the native program sees exactly one copy — and the one
  the binding actually validates against.
- **`AbortSignal.timeout` is not in React Native.** `fetchBasemapStyle` used it
  for its 6s ceiling; it is now an `AbortController` and a `setTimeout`, which is
  also the shape that works on the web. A fetch with no ceiling is precisely the
  case the raster fallback exists for.
- **React Native's `URLSearchParams` is a partial polyfill**, so `tileSources.ts`
  builds its query strings by hand. Same output for our three parameters
  (`encodeURIComponent` and `URLSearchParams` differ only on spaces, which a
  country code and a JSON array of them do not contain).
- **`unset CI` is not the same as `CI=`.** Expo's CLI reads `CI` through
  `getenv.boolish`, which throws `GetEnv.NoBoolean: is not a boolean` on an
  *empty* value — so exporting `CI=` to defeat the Phase 2 trap breaks the CLI
  outright. Unset it.
- **`Map` shadows the global of that name**, which Biome objects to; it is
  imported as `MapLibreMap`. The component really is called `Map` in v11.
- A `<Layer>` inside a `<VectorSource>` has its `source` prop injected by the
  parent (`cloneReactChildrenWithProps`), so a spec's own `source` and the
  source's `id` agreeing is belt and braces rather than load-bearing.

#### What is verified, and what is not

- **Web and mobile both clean** under `tsc` and Biome, at the repo root and in
  `mobile/`. The whole web app is the regression test for the shared-module
  refactor, and nothing in it changed behaviour.
- **The iOS bundle proves `@shared` resolves into `../src/lib`** — a grep of the
  Hermes bundle finds `railway_routes_scenic_outline`, `basemap_fade`, the liberty
  style URL, carto's `#4957ad` and "Noto Sans Bold", none of which exist anywhere in
  `mobile/`.
- **The composed style validates against MapLibre's own validator**
  (`validateStyleMin` from the style-spec package, run over the three sources and
  seven layers in all four theme × heritage combinations). That checks every
  expression in them, which is worth more here than it sounds: the spec validator is
  what would catch a paint property or an expression shape that `tsc` accepts as a
  tuple but MapLibre does not accept as a value.
- **The app builds and launches on the simulator** with MapLibre linked (SPM, via the
  config plugin) — which is the class of failure a fresh native dependency causes,
  and it does not happen.
- **The map has been seen on a device** (2026-09-17, iPhone, iOS 27). It renders, the
  **region switch works** (so `cameraRef.setStop` moves the camera, and the tile URL's
  new country filter reloads the source rather than leaving the old region's routes
  behind), **tapping a route works** — which is the answer to the open question about
  the feature id, since `track_id` is the MVT feature id that `ST_AsMVT` strips from
  the properties and the sheet has nothing else to identify a route by — and the
  **country borders** draw where they should. Phase 0's unverifiable risk, a spec-valid
  expression that kills the process at native style conversion, is therefore closed for
  the expressions currently on the map: they run.

  What that run did *not* exercise, because it needs state Phase 4 builds: everything
  below.

#### Still open in Phase 3

- **The highlight overlays are done** — built in Phase 4 alongside the state that
  drives them. See `HighlightOverlay.tsx` below.
- **The ridden-stretch coverage overlay** (`useCoverageOverlay`) is still open.
  `GET /coverage` **does exist** (Phase 1 built it after all; this file said
  otherwise and was wrong), so nothing is blocking it but the work.

Two smaller gaps, neither blocking: the **station search** box (the web map's own,
`useStationSearch`) and **"where am I"** — the binding has `<UserLocation>` and
`trackUserLocation` on the camera, and it wants a location-permission string in
`app.json` for both stores anyway.

### Phase 4 — Features — **in progress**

Done: the **route logger** (map selection → a logged journey), the **highlight
overlays** Phase 3 left behind, and the **logbook** list. Still to do: the journey
planner, country stats, station search, and the coverage overlay.

#### What is built

| | |
| --- | --- |
| `SelectionContext.tsx` | the Route Logger's selection, cleared on a region switch. Holds the tile feature itself plus `partial` and the stretch, so the logging screen renders a route with the same `routeTitle`/`routeBadges` the map sheet does |
| `SelectionBar.tsx` | "N routes selected" under the map, and the way into the logging screen |
| `app/log-journey.tsx` | the form: name, date, description, an optional trip, and the per-route partial toggles. A modal over the tabs, since it exists only while there is a selection to spend |
| `HighlightContext.tsx` | what the map is pointing at on someone else's behalf — the web's `highlightedRoutes`, gold or orange |
| `HighlightOverlay.tsx` | both halves of a highlight set as children: the tile-filter `<Layer>`s and the `<GeoJSONSource>` of cut geometry |
| `HighlightChip.tsx` | what the map is showing, and the way to drop it |
| `logVersion.ts` | the store that says the user's log has changed |
| `app/(tabs)/logbook.tsx` | the paginated, searchable list of trips and journeys, each card able to point the map at its routes |

#### What the highlight overlays cost the web app

The same shape as Phase 3: **a shared module first, then two mechanisms.**
`src/lib/map/highlightLayers.ts` now holds what a highlight *is* — `highlightVariants`,
the layer factories, the id and filter helpers, `partialHighlightData`,
`wholeRouteIds` — and `useRouteHighlighting` is what is left over, which is only the
live-map mechanism (`addLayer` / `setFilter` / `removeLayer`). Nothing about the web
app's behaviour changed; `HIGHLIGHT_LAYER_IDS` is re-exported from the hook, so its
two other callers did not move.

`getUntimezonedDateStr.ts` joined the shared set at the same time, unchanged — it is
dependency-free and the date a journey is logged against is the same decision on
both clients.

#### The one native-side decision worth writing down

**`beforeId`, not mounting order.** A `<Layer>` mounted after the map has loaded is
appended to the *top* of the style, so a highlight set that appears when a card is
opened would draw over the station labels. Both halves therefore carry
`beforeId="stations"`, which is what the web app's `moveLayer` is for — and since
the binding inserts children in order, a variant's casing mounted before its own
layer still lands underneath it.

Three smaller ones:

- **`GeoJSONSource`, not `ShapeSource`.** The latter is rnmapbox's name; here the
  prop is `data`, not `shape`.
- **A tile is cached by URL, so the log version is spent as `cacheBuster`.** Visit
  colours are rendered into the route tile per user, so logging a journey has to
  produce a *new* URL — `railwayRoutesTileUrl` already takes one, for exactly the
  reason the web app's `useMapTileRefresh` needs it. `logVersion.ts` is a
  `useSyncExternalStore` rather than a context because the write happens in a modal
  and the readers are a tab away: the map's tile URL, the map's numbers, and the
  logbook list.
- **Verified the same two ways Phase 3 was**: all 12 highlight layers pass
  MapLibre's own `validateStyleMin` (a paint value `tsc` accepts as a tuple is not
  necessarily one MapLibre accepts), and the iOS bundle exports with
  `selected_routes_highlight` and `highlightCasing` in it — both from
  `src/lib/map`, neither anywhere in `mobile/`.

#### Rough edges left in what is built

- **The date is typed, not picked.** A native date picker is another native module
  and so another development build; the field takes `YYYY-MM-DD` with Today and
  Yesterday buttons beside it, which covers the case that actually happens.
- **Editing and deleting a journey or trip** are not wired up, though the endpoints
  are (`PATCH`/`DELETE`) and `endpoints.ts` already calls them.
- **The UI details have not had a pass.** What is built was run on the iPhone the
  day it was written and works; the spacing, wording and affordances are a later
  sweep, not a rewrite.
- **Only the `regular` highlight variant is confirmed drawing.** The heritage and
  special ones — the dotted and dashed overlays, and the translucent casings under
  them — sit behind layer toggles that are off by default, so a device run does not
  reach them unless the toggles are on. They validate, and the expression shapes are
  the base layers' own, but that is not the same as having been seen.

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

Building iOS locally on the Mac with Xcode is the plan; **EAS Build** (cloud
compilation) and **EAS Submit** remain a working fallback and are what you would
need if the Mac went away. Local is faster than round-tripping to a cloud builder
and costs nothing.

- **Development builds are mandatory, not optional** — Expo Go can never run this
  app. See "Getting the tooling to run".
- Testing on your own iPhone needs only a **free** Apple ID. The $99/year Apple
  Developer Program is for TestFlight and the store, i.e. Phase 6.
- The **iOS Simulator** and the **Android emulator** are fine for correctness but
  render on the Mac's GPU — **any frame-rate number from either is meaningless.**
- If you fall back to EAS: cloud builds are minutes each and metered on the free
  tier, so budget for patience or a paid tier during Phases 3 and 5.

### Per platform

|                   | iOS                                                                | Android                                                |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| Developer account | Apple Developer Program, **$99/year** (Phase 6 only)               | Google Play, **$25 one-time**                          |
| Build             | locally on the Mac with Xcode; EAS Build as fallback               | locally with Android Studio; EAS Build as fallback     |
| Testing           | iPhone available ✓                                                 | **no device yet** — emulator only, so fps unmeasurable |
| Review            | slower, stricter; expect a rejection round                         | faster, laxer                                          |
| Store paperwork   | screenshots at several sizes, privacy manifest, privacy policy URL | data safety form, target-API-level requirements        |

Both stores need a privacy policy URL and an account-deletion path if the app has
accounts — which this one does.

### Also needed

- A physical **Android device** — the one hardware gap. The iPhone is covered.
- Location-permission strings that explain *why*, for both stores.
- The API from Phase 1 deployed and versioned.

---

## Open decisions

- **Offline route colouring** (Phase 5) — the stale-tile problem above. This is
  the one real design question left in the project.
- **Does admin ship?** Recommend no. It is a single-user surface, it works on the
  web, and it would roughly double the API layer and the map work (route
  creation, geometry editing, notes).
- **Shared public maps** — does the app open a `/shared/<token>` link, or bounce
  it to the browser? Deep links are cheap; the read-only map view is not free.
  Phase 1 left the endpoints out, which costs nothing to reverse: the queries are
  already shared through `progressQueries.ts`, so four token-resolving handlers
  are all that is missing whenever the answer is yes.
- **How much does the web app converge?** After Phase 1 the web app could also
  move off server actions onto the same HTTP API. Tempting for consistency, but
  it is a large refactor of working code for no user-visible gain. Recommend not
  doing it — let the two clients share the query modules, not the transport.

**Closed:** *One region or both?* — both, confirmed on the device in Phase 0.
Europe and Japan are bounding boxes and the tile volumes behave for each.

---

## Session log

Newest last. One line per session: what moved, and what the next session should
pick up. Keep it short — the phase sections carry the detail.

- **2026-08-27 — Phase 0, start to finish.** Verified the library landscape
  against the real packages and corrected six wrong assumptions in this plan.
  Built the spike, then ran it on a physical iPhone and an Android emulator.
  Found and fixed three things: the `std::bad_alloc` colour expression (the fix
  went into the **web app** too, so both platforms share one shape), the
  `Invalid geometry in line layer` warning (liberty's `park_outline`, not our
  tile — `filterPointsFromParkOutlines` now in `basemap.ts`), and the
  `initialViewState` camera trap. Answered every Phase 0 question except a
  frame-rate *number*; the subjective answer to the same question is "smooth at
  Europe z4", which is what it existed to establish. **Decision: GO.** Deleted
  `mobile-spike/` and moved its tooling setup into this file. **Next: Phase 1**,
  the HTTP API layer — the inventory is in its section.
- **2026-08-27 — Phase 1, start to finish.** Lifted every user-scoped query out
  of the `"use server"` modules into plain modules taking a `userId` (the
  `*Actions.ts` files kept their signatures, so no component changed), split auth
  into `authTokens` / `authQueries` / the cookie-only `authActions`, and built 23
  handlers under `/api/v1` with bearer auth and a 7d/180d token pair. Added
  `ValidationError` to separate a message meant for the user from one meant for
  the log — the smoke test caught a rejected password coming back as a 500.
  Wrote `API.md`. Verified every endpoint plus a full create/assign/delete
  lifecycle against the dev database, and checked the planner endpoint agrees
  with `npm run inspectPath`. **Next: Phase 2**, the Expo shell — nothing in the
  API needs proving first.
- **2026-08-27 — Phase 2, start to finish.** Scaffolded the Expo app in `mobile/`
  (SDK 57, RN 0.86, expo-router, NativeWind 4 on Tailwind 3) and wired it to
  production over HTTPS, which is already serving `/api/v1`. Built the auth story
  (keychain token pair, single-flight refresh, `Stack.Protected` routing), the
  region switch, and a Light/System/Dark setting; the Map tab shows this region's
  progress as the end-to-end proof until Phase 3. Chose to **import the web app's
  `src/lib` directly** (`@shared/*` + Metro `watchFolders`) rather than copy it, so
  `style.ts` stays one source of truth for Phase 3. Four new tooling traps, all
  npm-12 or SDK-57 packaging rather than anything to do with the map — written up
  in the phase section; `create-expo-app` itself does not run. Extended
  `generateAppIcons` to feed the native icon set from the same master. Built and
  ran it on the iOS simulator, which caught one bug no typecheck could
  (`className` on expo-router's `Link` is accepted and ignored) and confirmed the
  cold-start routing and dark mode; signing in against production then confirmed
  the authenticated half by hand. **Next: Phase 3**, the map.
- **2026-08-27 — Phase 3, the map.** Added
  `@maplibre/maplibre-react-native` 11.3.7 and its config plugin, and built the map
  out of the web app's own layer specs rather than a port of them — which took a
  **web-side refactor first**, because three things made `src/lib/map` unimportable
  from React Native: a tile host read off `window.location` at module load (source
  factories now take the host, `index.ts` binds the web's), `maplibre-gl` types (now
  `@maplibre/maplibre-gl-style-spec`, so a layer spec and a `<Layer>`'s props are one
  type), and the `@/*` alias (relative imports only in shared modules; this is what
  moved `resolveMissingBasemapIcons` into `missingIcons.ts`). Lifted two more pieces
  into the shared set on the way: the toggle filters (`scenicOutlineFilter`,
  `clickBufferFilter`) and `map/routeFeature.ts`, so the web popup and the native
  sheet render the same badges rather than two implementations of them. On the native
  side: basemap with all five transforms, the whole route stack, stations and labels,
  public notes, visit colours, the country filter, region-scoped camera with a saved
  position per region, layer toggles in Settings, a tap-to-inspect sheet, and the
  progress pill. Four new traps, the sharp one being that **two copies of the
  style-spec package do not typecheck against each other** (a `paths` entry pins the
  native program to the binding's own copy) — the Phase 0 note claiming otherwise has
  been corrected in place. Web and mobile both clean under `tsc` and Biome, and the
  iOS bundle proves `@shared` really resolves into `../src/lib`. **Left deliberately:
  the highlight and coverage overlays**, both driven by selection and journey state
  that arrives with Phase 4 — inventing that state twice was the alternative.
  **Next: Phase 4**, and those two overlays on top of it.
- **2026-09-17 — merged `main` into the branch, and ran Phase 3 on a device.** Phase 3
  was committed, then eight commits from `main` merged in (docker updates, map tweaks,
  **country borders**, dependency bumps). Three conflicts, all one shape: `main` had
  gone on writing `src/lib/map` the web way while this branch made it importable from
  React Native. Resolved by keeping the shared shape and taking the feature into it —
  `createCountryBordersLayer` now types against `@maplibre/maplibre-gl-style-spec` and
  `main`'s copy of `resolveMissingBasemapIcons` was dropped, this branch having moved
  it to `missingIcons.ts` (the one piece needing a live `maplibregl.Map`). The lockfile
  needed no network: `@maplibre/maplibre-gl-style-spec` was already in the tree at
  26.4.2 under `maplibre-gl`, so promoting it to a direct devDependency was the whole
  change. **The merge also exposed the first cost of the shared set**: the borders
  layer was written for one consumer and there are now two, so the native map would
  have silently lacked them — `useBasemapStyle` now bakes them in, stacked as
  `useMapLibre` stacks them. Then **built and ran on the iPhone**: signing needed a
  detour (see the new trap under "Getting the tooling to run" — `expo run:ios` cannot
  do a first device build), and the map renders, switches region, answers taps and
  draws its borders. **Next: Phase 4.**
- **2026-09-17 — Phase 4, first half: the route logger, the highlight overlays and
  the logbook.** Took the same shape as Phase 3 — **a shared module first, then two
  mechanisms**: `src/lib/map/highlightLayers.ts` now holds what a highlight *is*
  (`highlightVariants`, the layer factories, the filter and id helpers,
  `partialHighlightData`), leaving `useRouteHighlighting` as nothing but the live-map
  mechanism, and the native `HighlightOverlay` mounts the same specs as children. The
  web app's behaviour is unchanged and `HIGHLIGHT_LAYER_IDS` is re-exported from the
  hook, so its two other callers did not move; `getUntimezonedDateStr.ts` joined the
  shared set unchanged. On the native side: a selection context cleared on a region
  switch, an "N routes selected" bar under the map, a modal logging form (name, date,
  description, optional trip, per-route partial toggles), a highlight context the
  logbook points at the map, a dismissable chip saying what the map is showing, and
  the paginated searchable logbook list. One new mechanism worth knowing: **a
  `<Layer>` mounted after the map has loaded is appended to the top**, so both
  highlight halves carry `beforeId="stations"` — the declarative form of the web
  app's `moveLayer`. A `logVersion` store (`useSyncExternalStore`, no provider)
  carries "the log changed" from the modal to the three readers a tab away, and is
  spent on the map as the route tile's `cacheBuster`, since visit colours are baked
  into the tile per user. Corrected one wrong claim in this file: `GET /coverage`
  **does** exist. Verified as Phase 3 was — `tsc` and Biome clean in both apps, all 12
  highlight layers pass `validateStyleMin`, and the iOS bundle exports with the shared
  module's strings in it, and then **run on the iPhone**, where the logger loop works
  end to end. **Next: the planner, country stats, station search and the coverage
  overlay**, plus a pass over the UI details of what is already there.
