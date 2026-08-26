# Mobile UI — fix list

Findings from a read of the mobile paths (`MainLayout`, `RailwayMap`,
`UserSidebar`, `JourneyLogger`, `JourneyPlanner`, `useIsMobile`, `globals.css`),
plus the installable-web-app work that belongs with them.

**Status: partially done.** Sections are deleted as they land and keep their
original numbers, so the gaps in the numbering are the finished work. Landed so
far:

- **1 — layout flash.** Two halves. `useIsMobile` moved to
  `useSyncExternalStore` and `useResizableSidebar` adjusts `sidebarOpen` during
  render, so the corrected mobile layout is in the first *hydration* render
  instead of a desktop-then-mobile flip. That still left the paint that comes
  *before* hydration: the navbar is the whole of what the server renders above
  an `ssr: false` map, so a phone painted the desktop bar while the bundle
  downloaded. It now picks its bar with `md:` classes and renders both, one
  `display: none` — the stylesheet is render-blocking, so the media query is
  resolved before the first pixel. `PublicMapLayout`'s region switch is
  server-rendered for the same reason and does the same.
- **2 — bottom sheet.** `MobileBottomSheet` replaced the fixed top `h-1/2`
  drawer: bottom anchored, four snaps (collapsed / peek 120px / half / 90%),
  drag or tap the handle, ArrowUp/ArrowDown, `map.resize()` once per settled
  height. The visual half followed. Rounded top corners over a 12px overlap of
  the map (a radius needs something behind it to show against) plus an upward
  shadow; the map takes the overlap back as height, and `globals.css` lifts
  MapLibre's bottom control stacks clear of the seam through
  `.map-pane:has(+ .mobile-sheet)`, so the admin and public maps keep theirs at
  the edge. A scrim fades the map in past the half snap and is tapped to drop
  back to it. The grabber is thinner, widens and darkens while dragging, and the
  collapsed band carries a caption ("Route Logger", plus the selected-route
  count) and a chevron instead of being a bare grey bar. The progress pill moved
  up to clear the raised scale bar, and the sidebar's right border is now
  desktop-only — inside the sheet it was a hairline down a rounded panel.
- **3 — hover-only popups on a touch device.** A tap now opens a **sheet** rather
  than the hover popup: the same title, badges and body, plus a wrapping row of
  buttons for what a mouse gets from hovering and double-clicking — "Add to
  selection" / "Remove from selection" (or "Add to journey" / "Remove from
  journey" while a journey card is open, which is what `JourneyEditStartFn`'s
  second callback is for) and "Website". The sheet is hung on that first button
  rather than on the tapped point — anchored `center`, then offset by the measured
  distance from its own middle to the button's — so selecting a route is a double
  tap in one place instead of a tap and a hunt, and the body sits above the finger
  where it can be read. No × on it: every tap ends it, a button having run its
  action on the way past. Because that puts the sheet and the route on the same
  spot on screen, a tap in the sheet and a tap on the map are told apart by
  geometry — a click inside the sheet's rect is the sheet's, one outside is the
  dismissal and nothing else, and taps for 400ms after it closes are still the
  tail of the gesture that closed it — or of the one that opened it (with
  double-click zoom suspended over the same span). Otherwise the sheet closed and
  instantly reopened, opened and instantly closed, or the two taps read as a
  double tap and zoomed. Both maps' interaction effects also had to learn to
  cancel a setup deferred to `"idle"`, which otherwise left a second live set of
  handlers behind after a re-run.
  MapLibre gives popups no `z-index`, so they also had to be lifted (30) over the
  progress box, the station search and the map's own controls. The tap no longer
  acts on the route by itself, so the sheet can say what the press will do, and
  the `dblclick` handler stands down on touch — every route has its
  double-tap-to-zoom back. Stations and public notes got the same treatment, the
  notes having had no touch path at all. Which mode is live is decided per
  interaction from `pointerdown`/`pointermove`, not from a width query, so a
  hybrid laptop keeps hover popups under its mouse. The shared map's routes are
  now readable on a phone too: its click handler is attached even though nothing
  there can be selected.
- **4 — via-station reordering.** The HTML5 drag handle (dead on iOS, which never
  fires `dragstart` from a touch) is gone; each via row carries ▲▼ buttons at
  `iconBtn("responsive")`, shown only once there are two vias to reorder. Also
  the first keyboard-operable reordering the field has had.
- **5 — touch targets.** 44pt floors (`min-h-11`, `w-11 h-11`) across the mobile
  paths, `md:`-reset so desktop keeps its density.
- **6 — the menu is a menu.** `MenuSheet` (behind the hamburger) replaced the
  `MobileMenuPanel` chip strip. Auth forms, both articles, the region switch and
  the layer switches are all in it; the navbar keeps title + auth / share /
  hamburger. **It is now the desktop menu too**, as a right-hand drawer over a
  scrim (the phone keeps the full-screen sheet; the direction is a media query on
  `.menu-sheet`, not a class React picks). That took the region switch and the
  How To Use / Railway Notes buttons out of the desktop bar, the layer switches
  out of the progress box at every width, and the two article views out of the
  sidebar — `ActiveTab` is down to the three logging tabs, and the articles no
  longer carry a header of their own.
  The desktop bar's Login/Register dropdowns went with them: the auth buttons now
  open the menu on the matching form (`onOpenMenu("login" | "register")`), so
  there is one copy of each form instead of a sheet copy and a `w-96` dropdown
  copy, and the wording is Sign in / Create account / Log out throughout. The forms
  themselves got visible labels, real field spacing and a cross-link to each other
  (`ui/inputStyles.ts`) in place of the joined placeholder-only stack. Admin is
  back in the desktop bar as well as the menu — it is a constant back and forth.
- **7 — progress box collapses** to a percentage pill on mobile
  (`MapProgressBox`, now shared with the public map), and its layer checkboxes
  became `ToggleSwitch`es that live in the menu — the shared map, which has no
  menu, is the only one still carrying them in the box.
- **8 — safe areas.** `viewportFit: "cover"` in `layout.tsx`'s viewport export,
  and a `safe-area` utility in `globals.css` that pads the whole app frame back
  out of the notch and home-indicator strips (`h-dvh` + `border-box`, so it eats
  into the 100dvh rather than overflowing). The three `h-dvh` page roots wear it,
  as do the `fixed` overlays that sit outside them — the mobile menu, the admin
  drawer, and the toast stack (`safe-area-bottom`, since a top inset there would
  only add an invisible band over the map). The map's own `absolute` furniture is
  inside the padded frame and needed nothing.
- **9 — fonts.** Inter (not Geist — too display-leaning at 12–14px, which is
  where most of this app's text is), `body` no longer overrides it with Arial,
  Geist Mono dropped.
- **10 — dark mode.** The half-finished `prefers-color-scheme` variables are
  gone; item 13 below replaced them with the real thing.
- **11 — suggestion lists.** The dropdowns (map search on both maps, and
  `StationSearchInput`) `preventDefault` on pointerdown, so the input never loses
  focus and the 200ms blur timer cannot close the list under the tap — scrolling
  the list included. The timer stays for a genuine focus-out; selecting now blurs
  the field explicitly, so the keyboard still drops.
- **13 — dark mode (beta).** The palette *is* the token layer: Tailwind v4
  compiles `border-gray-300` to `var(--color-gray-300)`, so `html.dark` in
  `globals.css` re-points the neutral ramp and the whole app flips at once —
  no component rewrite, and a component written the ordinary way is
  dark-correct by default. Only two things could not ride on that. `bg-white`
  and `text-black` became `bg-surface` / `text-fg` (a mechanical rename), since
  `text-white` on a solid button and `bg-black/40` on a scrim mean the literal
  colour and must *not* invert. And the accent ramps flip only at their ends —
  50–300 are tints used as surfaces, 700–950 the text drawn on them, while
  400–600 are the solid buttons and stay put; the handful of places that used
  `hover:bg-blue-700` to mean "a step deeper" carry literal-hex `dark:`
  overrides instead, nearly all of them inside `buttonStyles.ts`.
  The scheme is a **setting** — Light / System / Dark in the menu, above the
  layer switches — kept in localStorage rather than `user_preferences`, so it
  needs no account and the shared map follows the *visitor*. An inline script in
  `layout.tsx` sets the class before first paint, so there is no white flash.
  On the map: the basemap swaps to OpenFreeMap's `dark` style (47 layers to
  liberty's ~110, no POIs and no extrusions to strip), the fade layer washes
  toward near-black instead of white and a little harder, the station labels
  invert — light text, translucent *black* halo — and the popups, whose inline
  styles no stylesheet can reach, read `var(--color-fg)` / `--color-link`
  directly. MapLibre's own popup chrome and control stacks are overridden in
  `globals.css`, its control glyphs being SVG fills with no colour hook.
  What is left is under item 13 below.
- **14 — interactive states.** `src/lib/ui/buttonStyles.ts` names the button
  roles (`btn`, `iconBtn`, `tabBtn`, `optionRow`, `LINK_BTN`) and carries
  hover / active / disabled for each; `globals.css` adds `cursor` and a
  `:focus-visible` ring as `@layer base` rules, so nothing can be missed by
  hand. All but a dozen bespoke controls (segmented switch, drag handle,
  scrim) now go through it.

What is left is 12, plus the tail of 13. Section 12 (installable app) is the
cheapest way to get the app onto a home screen, and worth having whether or not
the native app in `MOBILE_APP_PLAN.md` happens.

---

## 12. Make it installable (home-screen app)

Roughly half a day. No Mac, no Xcode, no developer-program fee, no store review.
Gets an icon on the home screen and a standalone window with no browser chrome.
Does **not** get: store listing, real offline maps, background geolocation, push —
those are what `MOBILE_APP_PLAN.md` is for.

- [ ] **Web app manifest.** Add `src/app/manifest.ts` (Next's file convention,
      returning a `MetadataRoute.Manifest`). Needs `name`, `short_name`,
      `start_url: "/"`, `display: "standalone"`, `background_color`,
      `theme_color`, and the icon list.
- [ ] **Icons.** `src/app/apple-icon.png` and `favicon.ico` already exist.
      Android additionally wants 192×192 and 512×512 PNGs declared in the
      manifest, plus a `maskable` variant so the launcher can crop to the
      device's icon shape without clipping content.
- [ ] **`theme-color`** in `layout.tsx`'s metadata, so the status bar matches the
      navbar instead of defaulting to white.
- [x] **`viewportFit: "cover"`** in the `viewport` export — done with item 8,
      which is where the `env(safe-area-inset-*)` padding lives.
- [ ] **Service worker** for the app shell. Keep it conservative: cache the shell
      and static assets, leave tile and API requests network-first. Caching MVT
      tiles is tempting but it is not the same thing as offline maps (see the
      plan doc), and a stale route tile shows wrong visit colours.
- [ ] **Verify standalone mode.** `h-dvh` behaves differently without browser
      chrome; check the sheet from item 2 and the bottom overlays in item 8 once
      installed, not just in Safari.

---

## 13. Dark mode — what the beta left out

The scheme, the token layer and the basemap are done (see the landed list
above). Three things were deliberately not attempted:

- [ ] **The route colours are still the light ones.** `COLORS.railwayRoutes` —
      visited green, partial orange, unvisited red, each with a darker highspeed
      shade — was picked against a white basemap. The saturated branch/main
      shades carry on the dark ground, but the highspeed ones (`#7a3633`,
      `#155e34`) are close to muddy on it. Re-picking them is not the hard part;
      *delivering* them is: `userMapLayers.ts` builds its paint configs as
      module-level constants at import time, on purpose (stable references for
      `useMapTileRefresh`, and both maps must draw identical lines), so a
      per-scheme palette means turning those constants into memoised functions
      and threading the scheme through `RailwayMap`'s tile-refresh configs too.
      The stations layers show the shape of it — they take the scheme as an
      argument because they were the only two whose colours depend on the ground
      under them rather than on the data in them.
- [ ] **The popup badges stay bright.** The line-class, Scenic and frequency
      chips in `tooltipFormatting.ts` are pastel fills with dark text, and they
      read as chips on a dark popup rather than as a mistake — but they are the
      one thing in the app still lit from the light palette.
- [ ] **The admin page cannot change the scheme.** It has no menu (its hamburger
      opens the sidebar drawer), so the switch is not reachable there; it follows
      whatever the main map set. Either put a compact switch in the admin bar
      beside the region switch, or leave it — "Back to Main Map" is one click.
