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
      check that it still does. `expo-system-ui` exists only for Android. The map's open search should keep its place above the progress box with the keyboard up (the window resizes, so `useKeyboardTop` finds no overlap). Since 2026-11-19 the planner is a half-height `formSheet` over an undimmed map (`plannerSheet.ts`): check the map above it takes taps, that `plannerSheetCover`'s estimate puts a raised route sheet just above it (Android measures detents without the top inset while `sheetShouldOverflowTopInset` is off), and that the open search's tap-to-close layer stays above the "Plan journey" pill (it carries an `elevation` for this, `MapTopControls.tsx`). Do this before
      the UI pass, so the pass covers both platforms.

---

## Medium — UX gaps against the web and platform conventions

- [ ] **A chain can't be shown alone on the map.** On the web, pressing a chain
      highlights just its routes and fits to them. The app's map fits only to a box the
      server sends, and `GET /journeys/:id` sends one for the whole journey. The query
      already computes each route's box before taking their union
      (`journeyWithBoundsForUser`, `routeBoxSql`): return the boxes per route (or per
      track id beside `bounds`), union a chain's in the app, and make `ChainRow`
      pressable where there is more than one chain. Low.

- [ ] **A trip can't be made from the logging screen.** The logbook's "New trip"
      (`app/edit-trip.tsx`) makes one, but `TripPicker` in `log-journey.tsx` offers only
      trips that exist. Add "New trip…" there, picking the new trip once made. Low.

- [ ] **The logbook needs pull-to-refresh, and should probably scroll endlessly.**
      Lists on a phone are refreshed by pulling down (`FlatList` `refreshing` /
      `onRefresh`), and that doesn't exist here. Previous/Next paging copies the web's
      sidebar. On a phone the convention is to load more with `onEndReached`. Changing
      pages also shows no loading state: the old page stays until the new one arrives.

- [ ] **The journey date is typed as text.** The plan ruled out a native picker
      because it would need "another development build". But every run is already a
      development build, so `@react-native-community/datetimepicker` costs only one
      rebuild. The typed date is checked before sending and shown in the phone's
      format beneath the field since 2026-11-19.

- [ ] **Logging a journey gives no confirmation.** The modal closes and the route
      changes colour after the tile reloads (with a blink). The web shows a success toast.
      Add a short toast or banner ("Journey logged · View in logbook"). The same goes
      for an edit saved and a journey or trip deleted.

- [ ] **Check route taps offline on the device.** _(device)_ Since 2026-11-19 a
      route's details are kept once read (`src/map/routeMetadataCache.ts`): a route read
      before opens at once and is refreshed by a new read, and a failed or timed-out
      (8s) read shows a notice in place of the sheet (`MapNotice`) instead of doing
      nothing. Check: a route opened online opens again in airplane mode; one never
      opened shows "No connection…" (closing any open sheet), which goes after about four
      seconds, on its ×, or with the next press; back online, that route opens. On 2026-11-19 the notice showed, under the progress box; the box is now a child of `RailwayMap`, drawn under the sheet and the notice: check it is covered now.
      Every route opening offline is Phase 5 (`MOBILE_APP_PLAN.md`).

- [ ] **The feature sheet is a static view.** It has no slide-in animation, can't be
      dragged down, and `pb-8` is fixed. A bottom sheet that can be swiped away is what
      people expect (`@gorhom/bottom-sheet`, or a Reanimated panel, since Reanimated is
      already a dependency). Low effort, and the map feels much more native with it.

- [ ] **Navigation headers are made by hand.** `countries.tsx` uses a "Back" text
      button, and the modals use "Cancel"/"Close" ghost buttons in a custom bar. The native
      stack header (`headerShown: true` with a title) gives the platform back chevron, a
      large title, the right placement on Android, and Dynamic Type for free.

- [ ] **Finish checking editing and deleting on the device.** _(device)_ Confirmed
      on the iPhone 2026-11-19/20: the editor opens with the journey, "X km of Y", the
      "Editing “…”" bar, Continue editing / Cancel editing and "Unsaved changes…" on
      the card, the sheet's "Add to the journey" and remove, the planner's add, "Add
      more on the map" and its hint, the progress box and "Plan journey" riding above
      a route sheet, the selection coming back after Save and Cancel editing, and
      Delete on a journey asking and the list reloading without it. Still to run: Save
      sends only the change (rename on the web meanwhile, then change only the date
      here: the web's name stays); a partial ride saved untouched keeps its stretch;
      Cancel editing with changes asks; Edit on another journey with changes asks;
      removing every route then Save offers Delete; Delete on a trip asks and the list
      reloads; "New trip" and "Edit trip" save; a closed route in the editor shows its
      badge.

---

## Low — polish and consistency

- [ ] **Check the 2026-11-20 polish batch on the device.** _(device)_ Not run yet:
      the return key moves through sign-in, register, New/Edit trip and the journey
      form (Name → Date → Description) with the keyboard staying up
      (`submitBehavior="submit"`); VoiceOver reads the progress box's numbers
      (collapsed and expanded), "N routes highlighted" on the chip with its hint, a
      toggle's hint line, and the selection bar's km; the switch inside a toggle row is
      not a second stop; a cold start with a theme other than the system's doesn't
      flash and the splash stays up until both the theme and the session are read
      (`ThemeContext` `ready`, gated in `RootNavigator`); an invalid field keeps its
      background in dark mode; planner legs in Japan show the line name above the
      endpoints; deleting the only item on the logbook's last page goes back a page;
      switching region resets the logbook's page, search and open card; Settings shows
      "Version 0.1.0" (with the server only in a development build).
- [ ] **The expanded progress box is wider since km show one decimal** ("12,345.6 /
      98,765.4 km", was whole km), from the one `formatKm` (`src/ui/format.ts`). Look
      at it on a small phone in Europe; if it crowds the corner, add a whole-km variant
      for the box alone.
- [ ] **Settings hides the server address in every non-`__DEV__` build**, release-mode
      preview builds included. If preview or TestFlight builds will point at a test
      server, gate it on a build-profile flag (an `EXPO_PUBLIC_` variable or
      `expoConfig.extra`) instead, so a tester can see which server it is.
- [ ] **Is 6 characters enough for a user's password?** Register now states the
      rule as a hint, as the web's form does, but the admin needs 12
      (`createAdmin`). Raising it is one check in `authQueries.ts` and the two forms' hints.
- [ ] **Settings shows the version but not the build number.** The build number is
      `expo-application`'s (`nativeBuildVersion`), a native module, so adding it needs a
      new development build. Add it beside the version once the store builds are numbered.

---

## Journey planner polish (ideas from 2026-11-19)

The planner became a half-height sheet over a live map on 2026-11-19, with station
taps filling its target slot and its button at the bottom right (`MOBILE_APP_PLAN.md`,
the log). These are for the UI polish pass, not fixes.

- [ ] **Show the planner's stations on the map.** Mark From, To and the vias as
      labelled pins (A / B, or From / To) while the form holds them, so which end is
      which shows without looking at the sheet, and the target slot's station could be
      picked out. A GeoJSON source over the stations layer, fed from `PlannerContext`'s
      form (each `Station` carries its coordinates). Keep it clear of the gold path's
      own styling (`src/lib/shared/map/CLAUDE.md`).
- [ ] **A swap button between From and To**, as most planners have. One `editForm`
      that exchanges the two (the answer goes with it, as with any edit).
- [ ] **A haptic tick when a map tap fills a slot** (`pickOnMap`), and perhaps when
      a path is found. Needs `expo-haptics`, so a development build.

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
- [ ] **No "Go to my location" button.** The web map has one (MapLibre's
      `GeolocateControl`, top right, `enableHighAccuracy` and `trackUserLocation`, in
      `useMapLibre.ts`): a tap centres the map on you and keeps following, and a pan
      _or a zoom_ releases the lock while the dot stays (`watchGeolocateZoom`, since
      MapLibre keeps the lock through a zoom and the next fix undoes it). The binding
      has `<UserLocation>` and `trackUserLocation` on the `<Camera>`
      (`MOBILE_APP_PLAN.md`, the gap left from Phase 3). It needs the permission string
      (`NSLocationWhenInUseUsageDescription`, through `expo-location`'s config plugin or
      `app.json`) and a development build. Place it over the bottom-right corner,
      above the planner button (the top is the search bar and the chip row since
      2026-11-19), where the attribution's button sits now: move that to the
      bottom-left above the progress box. Keep `fitCamera`'s padding clear of it
      (`fitPadding` in `RailwayMap.tsx`). Check on the device that a zoom releases the lock here too,
      and that a denied permission says so rather than doing nothing. Medium.
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
- [ ] **A location-permission string**, needed by "Go to my location" (under "New
      gaps against the web").

---

## Already tracked in `MOBILE_APP_PLAN.md` (listed here so this is the one list)

- [ ] Offline route colouring before Phase 5. Since 2026-11-15 the route tile is
      Martin's and the same for everyone, and the colours come from `GET /rides`, so
      the question is now only how the last rides answer is kept on the device.
