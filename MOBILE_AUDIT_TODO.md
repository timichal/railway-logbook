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
      Delete on a journey asking and the list reloading without it; on 2026-11-20 Save
      sending only the change, a partial ride saved untouched keeping its stretch,
      Cancel editing and Edit on another journey asking when changed, and an emptied
      journey's Save offering Delete; Delete on a trip, "New trip" and "Edit trip";
      Edit and Continue editing going to the map flown to the journey. Still to run: a
      closed route in the editor shows its badge (no closed routes in the data yet).
      And the 2026-11-20 merge of Show and Edit into **"Open on the map"**: it flies to
      the journey with every highlight gone (a trip's, another journey's, the
      planner's); the bar reads "“Name”" with "tap to edit", then "unsaved changes, tap
      to save" after a change; its × closes without asking when unchanged; the journey
      stays open across tab switches; the card is always "Open on the map" + Delete,
      with "Unsaved changes…" under the open one when changed; Open on the open journey
      goes back to it without asking, on another asks if changed; Delete on the open
      journey closes it with the delete; the form's button reads "Close journey", then
      "Discard changes"; a trip's "Show on the map" still highlights orange. And the
      selection bar is the map's footer since 2026-11-20 (`RailwayMap`'s `footer`): it
      lies over the map, so the map no longer jumps as it comes and goes, while the
      progress box, the corner buttons, a route's sheet and a notice stand on it and
      move with it. Check: no jump on the bar's ×, on Save, or on the first route
      tapped; the furniture clear of the bar; an opened journey's ends land clear of
      the bar. (A raised sheet over the planner's, with `plannerCover` now measured on
      the full-height map, checked out on 2026-11-20.)

---

## Low — polish and consistency

- [ ] **Check "where am I" and the map credits on the device.** _(device)_ Built
      2026-11-20, needs a fresh build (`npm run prebuild`, then `npm run ios`: it brings
      in `expo-location` and `expo-haptics`). Check: the first press asks, Allow flies
      to you at zoom 12 or closer and the dot stays (also after a relaunch); "Allow
      Once", then a relaunch shows no dialog and no dot until pressed; Don't Allow
      shows the notice, and its Settings button opens the app's settings; a second
      press after moving lands where you are, not where you were; a tap on the map
      while it waits stops the spinner; the "off the map" notice (switch region to see
      it), and "Show Japan/Europe" landing on you; the corner buttons ride above a
      route sheet, a notice and the planner's sheet; the ⓘ card's links open, and lists
      only OpenStreetMap on the raster fallback; no shadow warnings. On Android:
      "Approximate" counts as allowed and isn't asked to upgrade on the next press.

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
      Settings shows
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
      a path is found. `expo-haptics` is installed (2026-11-20) and needs no config
      plugin, so this is JS only once the build that carries it is on the phone.
- [ ] **A route or station sheet raised over the planner hangs in mid-air as the
      planner is swiped away.** _(device, seen 2026-11-20)_ The raised sheet sits at
      `plannerCover`, which allows for the half detent only (`plannerSheet.ts`), and
      drops to the map's bottom edge only once `PlannerContext.sheetOpen` goes false,
      after the dismiss has finished. So for about a second it floats in the middle
      with nothing under it. Fix: drop the raise as the dismiss starts (the screen's
      `transitionStart` or `beforeRemove` event, or react-native-screens'
      `onSheetDetentChanged`), and perhaps animate the sheet down rather than jump.
- [ ] **The selection bar is under the planner's sheet while it is up.** It always
      was (a flex sibling below the map, now the map's `footer` at its bottom edge),
      but `mobile/CLAUDE.md` says what runs along the map's bottom edge rides above
      `plannerSheetCover`. Kept under on purpose for now: above it, the bar and a
      raised route sheet would stack over the half of the map left, and the planner
      says "Add routes to the journey" itself. Decide in the UI pass: raise it (the
      footer wrapper's `bottom: plannerCover`), or write the exception into
      `mobile/CLAUDE.md`.

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

---

## Already tracked in `MOBILE_APP_PLAN.md` (listed here so this is the one list)

- [ ] Offline route colouring before Phase 5. Since 2026-11-15 the route tile is
      Martin's and the same for everyone, and the colours come from `GET /rides`, so
      the question is now only how the last rides answer is kept on the device.
