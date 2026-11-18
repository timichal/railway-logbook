# Mobile app audit — to-do

Found in an audit of `mobile/` on 2026-10-14: every file under `mobile/app` and
`mobile/src`, the config (`app.json`, Metro, Babel, tsconfig, Biome), and how they use
`src/lib/shared/` and `/api/v1`. It looked for bugs, weak foundations, UI/UX problems
against platform conventions, and gaps against the web app.

It was a static read. `npm run typecheck` and Biome are clean, and nothing was run on a
device. Items marked _(device)_ need confirming on the phone before or after the fix.
Gaps the plan already lists are kept apart at the bottom, so this file is the one list
of what is left. A finished item is deleted, not ticked; whatever it leaves to do
becomes an item of its own.

**Rechecked on 2026-11-18** against the web app's changes since the audit (closed
routes, link names, stretch highlights, the journeys refactor, the route tile moving
to Martin with the rides as a list, the versioned tile, the client country filter,
"Sign out other devices") and the Expo SDK 58 upgrade. Typecheck and Biome clean.
Items found already done were deleted; the gaps the web has opened since are under
"New gaps against the web".

---

## High — bugs and the foundation

- [ ] **Check the SDK 58 upgrade on the device.** _(device)_ On 2026-11-18 the app
      moved to Expo SDK 58, React Native 0.88, React 19.3, gesture-handler 3 and
      Reanimated 4.7 (now with `react-native-worklets`), and TypeScript 7. The map
      draws and routes are coloured. Left: the gesture-driven parts (map pan and press,
      modal swipe-down, the switches), since gesture-handler went up a major version.

      Warnings are read in React Native DevTools now (`mobile/CLAUDE.md`). The one it
      shows at startup, `ImageBackground is deprecated`, is known and harmless:
      NativeWind's runtime (`react-native-css-interop` 0.2.7) touches `ImageBackground`
      as it loads. It goes with NativeWind 5.

- [ ] **Finish checking the 2026-10-14 High fixes on the device.** _(device)_ The
      airplane-mode cold start, the map's top row, dark mode, a plain return after a
      minute, switching to a different account, and a return after logging on the web
      have been confirmed on the iPhone. Left:
  - A return after more than a minute **offline** changes nothing: routes, numbers and
    the logbook stay as drawn. Pulling down the notification centre doesn't count as leaving.
  - The error screen. It needs a throw during render, so add one temporarily: for the
    tab boundary, `if (Math.random() < 2) throw new Error("test")` at the top of
    `SettingsScreen` (Retry should keep the session); for the root one, the same line
    in `RootNavigator` (it renders without any provider). In a development build the
    red LogBox overlay comes first; dismiss it to see the screen behind.

- [ ] **How does MapLibre Native's disk cache treat the route tile?** _(device)_ It
      is Martin's now, the same for every account, and the colours are the rides
      (`useRides`, `GET /api/v1/rides`), so no cache can show another account's
      colours. Check how big the cache gets after some use, and whether a cached tile
      is served offline. Offline colouring now needs the rides too: the routes are
      drawn only once `useRides` has answered (the decision at the bottom).

- [ ] **Run it on Android.** The app shell, the map with overlays, the modals and the
      keyboard handling have never run on Android (`MOBILE_APP_PLAN.md`, Phase 2). The
      modals' keyboard fix relies on Android resizing the window. Edge-to-edge is
      always on since SDK 58 (`edgeToEdgeEnabled` left `app.json` with the upgrade), so
      check that it still does. `expo-system-ui` exists only for Android. Do this before
      the UI pass, so the pass covers both platforms.

---

## Medium — UX gaps against the web and platform conventions

- [ ] **Check the fly-to on the device.** _(device)_ "Show on the map" and a
      planner result now fit the camera (`mobile/src/map/fitCamera.ts`), once the map
      tab is in view. Check that the routes land clear of the top row and the progress
      box, that a plan is flown to when the planner modal closes (it relies on
      `useIsFocused` being false under the modal), that pressing "Showing on the map"
      again flies back after a pan, and that a short route stops at zoom 12. The fit
      waits for `onDidFinishLoadingStyle`: check that it still happens on the first
      "Show on the map" after a cold start, and after switching the colour scheme.

- [ ] **The station sheet has no actions.** Tapping a station shows its name and the
      word "Station". On the web, the touch sheet for a station is how the planner gets
      filled. Add "Plan from here" / "Plan to here" (and maybe "Add as via") that write
      into `PlannerContext` and open the planner.

- [ ] **The logbook can't show what a journey contains.** A journey card shows the
      description and "Show on the map". Since the journeys refactor (2026-11-14) the
      web card shows the routes as the lines of stations they were ridden along
      ("Praha – Beroun – Plzeň", `JourneyChainList`, built by `src/lib/journeyChains.ts`
      from each route's `ends`), with `LoggedRouteRow` for the detail. Journeys inside a
      trip can't be expanded at all. Load `GET /journeys/:id` when a card opens (it
      already returns `ends`) and show the chains. `journeyChains.ts` and what it imports
      (`geoUtils.ts`, `searchText.ts`) are dependency-free, so move them into
      `src/lib/shared/` rather than writing a second copy. This is also the base that
      editing will need (`journeyEdit.ts`, `JourneyEditForm` on the web).

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

## New gaps against the web (found 2026-11-18)

- [ ] **No "Sign out other devices".** The web menu has it since 2026-11-17
      (`SignOutOtherDevicesForm` → `signOutOtherDevices`): the password, then the
      account's `tokens_valid_after` moves to now, which also refuses every app token
      issued before it. `/api/v1` has no endpoint for it. One would have to answer with
      a fresh token pair for the calling device, as the web re-issues its own cookie,
      or the app signs itself out with the rest. Rate-limited with the sign-ins, as the
      web's is. A lost phone is the case it exists for, so it matters less in the app
      than on the web. Low.
- [ ] **No map-sharing settings.** The web's `ShareMapDialog` switches the public map
      on and off and shows its link. The app has neither the setting nor an endpoint
      for it. This is a separate question from opening `/shared/<token>` links (the
      open decision in the plan). Low.

---

## Store readiness (before Phase 6, but cheap to decide now)

- [ ] **Google Play also wants a deletion link outside the app** (a web page or URL
      in the listing for people who uninstalled it). The web menu's "Delete account" is
      that path once signed in; point the listing at the site and say so there.
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
- [ ] Offline route colouring before Phase 5. Since 2026-11-15 the route tile is
      Martin's and the same for everyone, and the colours come from `GET /rides`, so
      the question is now only how the last rides answer is kept on the device.
