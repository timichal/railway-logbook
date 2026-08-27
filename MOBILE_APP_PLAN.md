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
| **Phase 0** | **Done. Decision taken: GO** (2026-08-27). Both headline questions answered positively on real hardware |
| **Phase 1** | **Done** (2026-08-27). 23 route handlers under `/api/v1`, smoke-tested against the dev database. Reference: `API.md` |
| **Current phase** | **Phase 2 — the app shell.** Not started |
| **Blocked on** | nothing |
| **Next** | Create the Expo project and log in against `/api/v1/auth/login`. Budget the first half-day for the tooling under "Getting the tooling to run" |

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

| Question | Answer |
| --- | --- |
| Route tiles over HTTPS against the native SDK | **Yes.** No `onDidFailLoadingMap`. The z4 Europe tile — 789 KB of protobuf, ~5000 routes — fetches, parses and draws |
| Does it look like the web app? | **Yes.** Same colours, same relative line weights. Visit-status colouring via `?user_id=1` arrives correctly |
| Station labels: bold Noto or a substituted system font? | **Bold Noto.** The glyph path works |
| Japan: Latin script or kanji? | **Latin** — the `latinizeLabels` port does it. Native does *not* do this for free (see below) |
| Heritage as round dots, Special as dashes? | **Both render.** The zero-length `[0, 3]` dash plus a round cap gives dots on native as in GL JS. They read a little alike — a Phase 3 styling question, not a rendering one |
| Does the per-user tile join slow the first paint? | **No, effectively instant** — including `user_fully_ridden_routes`, the expensive half of the query |
| Frame rate, Europe z4, panning | **Smooth subjectively** — "not exactly 60, but fine" — at full zoom-out with the whole route stack on. Never captured as a *number*: the spike's meter was counting the wrong frames (see below) and the project moved on |
| Android | **Works** on an arm64 emulator, API 34+ — tiles load, expressions parse, the map renders. Its fps is meaningless (it renders on the Mac's GPU and is slow at everything) |

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
  from, so ported expressions typecheck against the **identical**
  `ExpressionSpecification`. The port can be properly typed, not loosely.
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

| Shape | Result |
| --- | --- |
| `all` condition, one branch | works |
| simple conditions, two branches | works |
| `match`, three branches | works |
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
there is no `window`; this becomes a build-time config constant per environment.

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


### Phase 2 — App shell (1 week) — **CURRENT, not started**

Expo project, navigation, login/register against the API, secure token storage,
region switching. No map yet. The tooling setup under "Getting the tooling to
run" is the first half-day of this phase; budget it.

The API is ready and documented in `API.md`; `POST /auth/login` returns the token
pair, `GET /auth/me` is the "am I still signed in" call, and
`POST /auth/refresh` is what a cold start should try before deciding it is logged
out. `getTileBaseUrl()`'s `window.location` needs replacing with a build-time
constant per environment, and the API base URL is the same decision — make it one
config module.

### Phase 3 — The map (2–3 weeks)

The big one. Basemap plus every railway layer, the visit-status colouring, the
country and usage-type filters, station dots and labels, tap-to-inspect, the
highlight overlays, the ridden-stretch coverage overlay. Port `style.ts` and
`userMapLayers.ts` first — having the styling constants already correct is what
makes this three weeks instead of five, and Phase 0 proved they are.

Two things Phase 0 hands you working: the colour expression's shape, and the
knowledge that the camera moves by stop rather than by `initialViewState`.

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

| | iOS | Android |
| --- | --- | --- |
| Developer account | Apple Developer Program, **$99/year** (Phase 6 only) | Google Play, **$25 one-time** |
| Build | locally on the Mac with Xcode; EAS Build as fallback | locally with Android Studio; EAS Build as fallback |
| Testing | iPhone available ✓ | **no device yet** — emulator only, so fps unmeasurable |
| Review | slower, stricter; expect a rejection round | faster, laxer |
| Store paperwork | screenshots at several sizes, privacy manifest, privacy policy URL | data safety form, target-API-level requirements |

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
