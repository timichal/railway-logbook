# Mobile app audit — to-do

Found in an audit of `mobile/` on 2026-10-14: every file under `mobile/app` and
`mobile/src`, the config (`app.json`, Metro, Babel, tsconfig, Biome), and how they use
`src/lib/shared/` and `/api/v1`. It looked for bugs, weak foundations, UI/UX problems
against platform conventions, and gaps against the web app.

It was a static read. `npm run typecheck` and Biome are clean, and nothing was run on a
device. Items marked *(device)* need confirming on the phone before or after the fix.
Gaps the plan already lists are kept apart at the bottom, so this file is the one list
to cross things off.

---

## High — bugs and the foundation

- [ ] **Opening the app offline signs the user out of the UI.** `AuthContext`'s cold
  start sends any failure of `GET /auth/me`, a `NetworkError` included, to
  `forgetSession()`. The tokens stay in the keychain, but the user lands on the login
  screen, and signing in there fails too because there is no network. This works
  against the whole reason for the app (on a train with no signal). Fix: keep the last
  `ApiUser` on the device (SecureStore beside the tokens). When tokens exist and the
  failure is a `NetworkError`, start `signedIn` with the cached user and check again
  later (on foreground or the next request). Only a rejected refresh should sign out.

- [ ] **A failed country-preference read or write replaces the whole map with red
  text.** `map.tsx` renders an error screen whenever `useEffectiveCountries().error`
  is set. That error also comes from a failed *save* (`CountryPrefsContext` sets it on
  rollback), even though `countries` is still valid. A read that fails at startup is
  never retried, and the screen has no Retry button, so the Map tab is a dead end
  until the app restarts. Fix: keep read and write errors apart. A write error is a
  message on the Countries screen and never blocks the map. A read error gets a Retry
  and, once offline support exists, a last-known list from the device.

- [ ] **Quick taps on country checkboxes can leave the app and server out of sync.**
  Each tap sends its own `PUT /preferences` with nothing ordering them, and each
  rollback restores the list as it was *when that tap happened*. A→B→C with B's request
  failing after C's succeeded rolls the UI back to A while the server holds C. If B and
  C arrive out of order, the server ends up with B while the UI shows C. Fix: send
  only the latest list (one in flight plus one pending, or a short debounce), and on
  failure roll back to the last list the server confirmed.

- [ ] **Signing out leaves the previous session's state behind.**
  `SelectionProvider`, `HighlightProvider` and `PlannerProvider` sit above the auth
  guard and clear only on a region switch. After a sign-out and sign-in as someone
  else, the old selection, the old planner form and the old user's journey highlight
  (with its `ownerKey`) are all still there. Clear all three when `status` leaves
  `signedIn`, as `CountryPrefsContext` already does. (The web drops drafts on a change
  of user for the same reason.)

- [ ] **Map controls overlap at the top.** *(device)*
  - `HighlightChip` uses `top-2` with no safe-area inset. The map runs under the
    status bar, so the chip sits under the notch or Dynamic Island. The search and
    planner buttons use `insets.top + 8`.
  - When the station search is open it spans the full width (`inset-x-2`), and
    `PlannerButton` is rendered after it at `right-2`, the same top and the same
    height. So it lands on the search field's × button.
  - With the chip moved down to the inset, it would collide with the open search
    field too.

  Fix: put the top controls in one safe-area row (search, chip, planner) that the
  open search replaces or pushes down, instead of three pieces placed separately. The
  plan's "Rough edges" already flags this risk.

- [ ] **Dark mode: icons and spinners that can't be seen.** `MapStationSearch`'s and
  `PlannerButton`'s icons are a fixed `#374151` on `dark:bg-gray-900/95`. `Button`'s
  `SPINNER` colour for `secondary` and `outline` is a fixed `#111827`, which is
  invisible on a dark screen. That hits the busy "Show on the map" button (outline) in
  the logbook. Fix: one module of colour values per scheme for the places where
  NativeWind can't reach (icons, spinners, the tab bar's `TAB_COLORS`,
  `placeholderTextColor`), read through `useTheme().resolved`.

- [ ] **"Show on the map" in the logbook ignores failures.** `ShowOnMap.show()` has
  `try/finally` and no `catch`, and is called as `void show()`. A failed
  `GET /journeys/:id` or `/trips/:id` becomes an unhandled promise rejection: the
  spinner stops and nothing is shown. Show the error next to the button.

- [ ] **Stale responses can land after a region switch.**
  - `map.tsx`'s `load()` has no cancellation. If the old region's `GET /progress`
    resolves after the new one has started, the progress box shows the old region's
    numbers. Use the `cancelled` flag or `AbortController` pattern the other screens
    use.
  - `RailwayMap`'s region-switch effect calls `loadMapPosition(...).then(setStop)`
    without cancelling. Two quick switches can apply the positions in the wrong order.

- [ ] **Route-tile cache and changing accounts.** *(device)* The route tile's URL
  doesn't depend on who is signed in (the bearer header carries that), and
  `logVersion` starts at 0 on every launch. So after a relaunch, or after one account
  signs out and another signs in, the URL matches tiles fetched earlier. The handler
  sends `private, no-store`. Check whether MapLibre Native's ambient (disk) cache
  honours that. If it doesn't, the user sees colours that are out of date, or another
  account's. Whatever the cache does, seed the cache buster with something unique to
  the launch and the session (for example a timestamp taken at sign-in) instead of a
  counter starting at 0.

- [ ] **Nothing refreshes when the app returns to the foreground.** There is no
  `AppState` handling anywhere. A journey logged on the web, or a day spent in the
  background, leaves the map colours, progress, coverage and logbook stale until the
  next log in the app. Separately, an access token that expires while the map is open
  makes route tiles fail with 401 and draw nothing (`tileAuth.ts` admits this). Fix: on
  `AppState` → `active`, refresh the token pair if it is near expiry (`expiresIn` is in
  the auth response but unused), then call `bumpLogVersion()`.

- [ ] **No error boundary.** If anything throws during render, the whole app shows a
  white screen with no way back. expo-router supports
  `export function ErrorBoundary` per layout: add one at the root (with Retry) and one
  in `(tabs)`.

- [ ] **Run it on Android.** The app shell, the map with overlays, the modals and the
  keyboard handling have never run on Android (`MOBILE_APP_PLAN.md`, Phase 2). The
  modals' keyboard fix relies on Android resizing the window (with
  `edgeToEdgeEnabled`, check that it does), and `expo-system-ui` exists only for
  Android. Do this before the UI pass, so the pass covers both platforms.

---

## Medium — UX gaps against the web and platform conventions

- [ ] **Opening a journey, trip or plan doesn't move the map to it.** On the web,
  opening something flies to it (`{ fit: true }`, a bounding box from
  `routeBoundsByIds`). Here "Show on the map" switches tabs but leaves the camera where
  it was, so the highlight may be off-screen. The same applies to a planner result.
  Have `GET /journeys/:id`, `GET /trips/:id` and `POST /planner` return the bounding
  box (the query already exists), and fit the camera with a `setStop({ bounds,
  padding })` that keeps clear of the controls.

- [ ] **A journey's highlight ignores partial rides.** `ShowOnMap` highlights whole
  routes. The web's view highlight draws only the stretch ridden for a route logged in
  part. `GET /journeys/:id` returns `covered_start`/`covered_end`, and
  `POST /coverage/stretches` turns those into geometry, so pass the result as
  `partials`.

- [ ] **The station sheet has no actions.** Tapping a station shows its name and the
  word "Station". On the web, the touch sheet for a station is how the planner gets
  filled. Add "Plan from here" / "Plan to here" (and maybe "Add as via") that write
  into `PlannerContext` and open the planner.

- [ ] **The logbook can't show what a journey contains.** A journey card shows the
  description and "Show on the map". The web card lists the journey's routes
  (`LoggedRouteRow`): name, length, partial or whole. Journeys inside a trip can't be
  expanded at all. Load `GET /journeys/:id` when a card opens and list the routes.
  This is also the base that editing will need.

- [ ] **Trips can't be created in the app.** `createTrip` is in `endpoints.ts`, but
  nothing calls it, so `TripPicker` offers only trips made on the web. Add "New trip…"
  to the picker, or a create button in the logbook.

- [ ] **The logbook needs pull-to-refresh, and should probably scroll endlessly.**
  Lists on a phone are refreshed by pulling down (`FlatList` `refreshing` /
  `onRefresh`), and that doesn't exist here. Previous/Next paging copies the web's
  sidebar. On a phone the convention is to load more with `onEndReached`. Changing
  pages also shows no loading state: the old page stays until the new one arrives.

- [ ] **The logbook keeps its page, search and open card across a region switch.**
  Page 3 of Europe becomes page 3 of Japan, which can be past the last page. The list
  is then empty and says "Nothing logged in this region yet". Reset all three when the
  region changes.

- [ ] **The journey date is typed as text.** The plan ruled out a native picker
  because it would need "another development build". But every run is already a
  development build, so `@react-native-community/datetimepicker` costs only one
  rebuild. Until then, check the format before submitting (the server's 400 is the
  only check now), and show the date in the user's locale (`formatDateOnly`) next to
  the raw value.

- [ ] **The log-journey form is lost on Cancel or swipe-down.** The selection
  survives, but the typed name, description, date and trip are gone. The web keeps
  them as a draft until Save or Cancel (`editGuard`). Keep the form in a small context,
  as `PlannerContext` does, and clear it after a successful log. iOS's swipe-down
  dismiss isn't guarded either (`gestureEnabled` / `usePreventRemove`).

- [ ] **Logging a journey gives no confirmation.** The modal closes and the route
  changes colour after the tile reloads (with a blink). The web shows a success toast.
  Add a short toast or banner ("Journey logged · View in logbook").

- [ ] **The map's station search results can't be scrolled.** `StationResults` is a
  plain `View` inside an absolutely positioned container. With the keyboard up on a
  small phone, the lower results sit behind the keyboard and can't be reached. Use a
  `FlatList` with a `maxHeight` and `keyboardShouldPersistTaps="handled"` (the
  planner's `ScrollView` already has the latter).

- [ ] **A failed station search says "No stations found."** `useStationSearch` treats
  errors as no match, which is misleading when offline. Show "Couldn't search — check
  your connection" instead.

- [ ] **Planner legs don't show the line name.** `PlannedRouteRow` shows only
  `from ⟷ to`. Where `hasRouteNames` (Japan), the line name is what identifies a route,
  and `PlannerRoute.name` is already in the response. Use `routeTitle` as the other
  route rows do.

- [ ] **Number formatting is inconsistent.** km is shown three ways: `toFixed(1)`
  (logbook, sheet, planner, selection bar), `Math.round().toLocaleString()` (progress
  box) and `toLocaleString("en-US", 1 dp)` (countries). Percentages are calculated
  again in `countries.tsx`. `MapProgressBox` prints `percentage.toFixed(1)` although
  the server already rounds to a whole number (`toUserProgress`), so it always shows
  "42.0%". Add one `formatKm` and one `formatPercent` (in `shared/progress.ts` next to
  `round1`, or a mobile util) and use them everywhere.

- [ ] **Screen readers miss information.** An `accessibilityLabel` replaces the
  element's text for VoiceOver and TalkBack:
  - `MapProgressBox` reads only "Show progress", never the percentage.
  - `HighlightChip` reads "Clear the highlight", never "3 routes highlighted".
  - `CardHeader` reads only the title, without date or stats.

  Put the content in the label, or move the action into `accessibilityHint`. Also,
  `ToggleSwitch`'s inner `Switch` is a second focusable element although the comment
  says it is decorative: add `accessibilityElementsHidden` and
  `importantForAccessibility="no-hide-descendants"`. `SelectionBar`'s label says "Log
  1 selected routes".

- [ ] **The feature sheet is a static view.** It has no slide-in animation, can't be
  dragged down, and `pb-8` is fixed. A bottom sheet that can be swiped away is what
  people expect (`@gorhom/bottom-sheet`, or a Reanimated panel, since Reanimated is
  already a dependency). Low effort, and the map feels much more native with it.

- [ ] **Navigation headers are made by hand.** `countries.tsx` uses a "Back" text
  button, and the modals use "Cancel"/"Close" ghost buttons in a custom bar. The native
  stack header (`headerShown: true` with a title) gives the platform back chevron, a
  large title, the right placement on Android, and Dynamic Type for free.

---

## Low — polish and consistency

- [ ] **Forms don't move to the next field.** Login and register set
  `returnKeyType="next"` but don't focus the next field, because `TextField` doesn't
  forward a ref. Forward the ref, then chain the fields with `onSubmitEditing`.
- [ ] **Register doesn't state the password rule up front.** Users need at least 6
  characters (`authQueries.ts`); add that as a `hint`. While there, consider whether 6
  is too low, given that the admin needs 12.
- [ ] **`TextField`'s error state drops the field's background**, so in dark mode an
  invalid field shows the screen colour through it. Keep the background classes and
  change only the border.
- [ ] **The theme preference is applied after the first render.** `ThemeContext`
  reads AsyncStorage in an effect, so someone who picked a theme different from the
  system's can see a flash. If the map mounts first, the basemap is fetched twice.
  Wait for the read before rendering, as `RegionProvider` does.
- [ ] **`LayerPrefsContext.setPref` writes to AsyncStorage from inside a state
  updater**, which `CountryPrefsContext`'s comment warns against. Also, a toggle made
  before the stored prefs have loaded is overwritten when they arrive. Write in an
  effect or from a ref, and merge the loaded value with any change already made.
- [ ] **`log-journey`'s "nothing left" effect calls `router.back()` without
  checking.** If the screen is ever reached with an empty selection (a deep link, or
  state restored after a crash), it is a `GO_BACK` with nothing to go back to. Use
  `router.canGoBack() ? back() : replace("/map")`.
- [ ] **Stale comments about NUMERIC.** `JourneyWithStats.total_distance` ("a string
  over the wire") and `logbook.tsx`'s `formatKm` ("arrives as a string; an absent one
  as null") contradict `dbConfig.ts`'s type parser and the `COALESCE`s in
  `tripQueries.ts`. Delete them. If either were true, `toFixed` would crash.
- [ ] **Constants copied instead of imported.** `logbook.tsx` defines its own
  `SEARCH_DEBOUNCE_MS = 300`, but `@shared/constants` exports it, and
  `useStationSearch` already imports it from there.
- [ ] **Settings shows `API_ORIGIN` at the bottom.** It's useful in development. For
  users, show the app version and build (`expo-constants`), and keep the origin only
  for non-production builds.
- [ ] **`SelectionBar`'s "clear" can't be undone** and sits right next to the row that
  opens the logging screen. A selection built from a planner result is easy to lose.
  Ask for confirmation once the selection has more than a couple of routes, or offer
  an undo toast.

---

## Store readiness (before Phase 6, but cheap to decide now)

- [ ] **Account deletion in the app.** Required by App Store guideline 5.1.1(v) and by
  Google Play for any app with accounts. The plan mentions it, but there is no
  endpoint and no UI. It needs `DELETE /api/v1/auth/me` (or similar), confirmed with
  the password.
- [ ] **Privacy policy URL** for both store listings, and a link to it in Settings.
- [ ] **The `NSLocalNetworkUsageDescription` / `NSBonjourServices` entries are for
  development** and will ship in a release build. Move them to an `app.config.ts` that
  adds them only for development builds.
- [ ] **`ios.supportsTablet: true`** means App Store review expects iPad screenshots
  and a usable iPad layout, and the iPad layout has never been looked at. Set it to
  `false` until iPad is a goal.
- [ ] **`ios.config.usesNonExemptEncryption: false`** (HTTPS only), so App Store
  Connect stops asking about export compliance on every build.
- [ ] **A location-permission string**, needed once the "where am I" button exists
  (the gap left from Phase 3).

---

## Already tracked in `MOBILE_APP_PLAN.md` (listed here so this is the one list)

- [ ] Re-run the 2026-10-14 device fixes on the iPhone (Status → Next, item 1).
- [ ] Japan's JR / Non-JR checkboxes and `showRegular`. This also removes
  `LayerToggles.tsx`'s `region.id === "japan"`, which `CLAUDE.md` forbids.
  `GET /progress` needs a usage-type parameter for it.
- [ ] Line-name search where `hasRouteNames` (the API has no endpoint for it yet).
- [ ] Editing and deleting journeys and trips (the endpoints already exist in
  `endpoints.ts`).
- [ ] The heritage/special highlight variants have never been seen on a device.
- [ ] "Where am I": `<UserLocation>` plus the permission string above.
- [ ] Decide how routes are coloured offline before Phase 5.
