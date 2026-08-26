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
  gone; see item 13 for doing it properly.
- **11 — suggestion lists.** The dropdowns (map search on both maps, and
  `StationSearchInput`) `preventDefault` on pointerdown, so the input never loses
  focus and the 200ms blur timer cannot close the list under the tap — scrolling
  the list included. The timer stays for a genuine focus-out; selecting now blurs
  the field explicitly, so the keyboard still drops.
- **14 — interactive states.** `src/lib/ui/buttonStyles.ts` names the button
  roles (`btn`, `iconBtn`, `tabBtn`, `optionRow`, `LINK_BTN`) and carries
  hover / active / disabled for each; `globals.css` adds `cursor` and a
  `:focus-visible` ring as `@layer base` rules, so nothing can be missed by
  hand. All but a dozen bespoke controls (segmented switch, drag handle,
  scrim) now go through it.

What is left is 12 and 13, in either order. Section 12 (installable app) is the
cheapest way to get the app onto a home screen, and worth having whether or not
the native app in `MOBILE_APP_PLAN.md` happens; 13 (dark mode) is a real project
rather than a fix.

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

## 13. Dark mode, for real this time

Item 10 deleted the boilerplate `--background`/`--foreground` pair and its
`prefers-color-scheme` override, because it was never wired up: `body` hardcoded
a white background while its *colour* followed the scheme, so on a machine set to
dark anything that inherited its colour rendered #ededed on white. `globals.css`
now says light-only outright.

Doing it properly is a real project, not a variable:

- **Every component is `bg-white` / `text-black` / `text-gray-*` / `border-gray-*`
  literals.** There is no palette to swap. The first step is a token layer —
  surface / surface-raised / text / text-muted / border / accent — and a pass
  converting the literals to it. `src/lib/ui/buttonStyles.ts` (item 14) is now
  the first stop: every button's colours are in that one table, so tokenising it
  covers most of the app's controls in a single edit. `MapProgressBox`,
  `MobileMenuSheet`, `MobileBottomSheet` and `ToggleSwitch` are the cleanest
  components to follow it with.
- **The map is the hard part.** `src/lib/map/style.ts` is the single source of
  truth for route colours, and they are chosen against a light basemap; the
  visited green / partial orange / unvisited red have to be re-picked for a dark
  ground, and the station labels' translucent white halo (`LABELS.station`)
  inverts. The basemap itself needs a dark vector style — OpenFreeMap serves
  `dark` alongside `liberty`, so `basemap.ts` would pick per scheme, and the
  `createBasemapFadeLayer` opacity needs re-tuning against it.
- **Decide whether it follows the OS or is a setting.** A setting means another
  `user_preferences` column plus a localStorage fallback for anonymous visitors,
  and the shared map has to follow the *visitor's* choice, not the owner's.
- **Popups are raw HTML strings** built in `tooltipFormatting.ts`; their inline
  classes need the same token treatment.
