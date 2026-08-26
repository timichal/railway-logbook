# Mobile UI — fix list

Findings from a read of the mobile paths (`MainLayout`, `VectorRailwayMap`,
`UserSidebar`, `JourneyLogger`, `JourneyPlanner`, `useIsMobile`, `globals.css`),
plus the installable-web-app work that belongs with them.

**Status: partially done.** Sections are deleted as they land and keep their
original numbers, so the gaps in the numbering are the finished work. Landed so
far:

- **1 — layout flash.** `useIsMobile` moved to `useSyncExternalStore` and
  `useResizableSidebar` adjusts `sidebarOpen` during render, so the corrected
  mobile layout is in the first paint instead of a desktop-then-mobile flip.
- **2 — bottom sheet, mechanics only.** `MobileBottomSheet` replaced the fixed
  top `h-1/2` drawer. The styling is still open; see the section below, which is
  what is left of item 2.
- **4 — via-station reordering.** The HTML5 drag handle (dead on iOS, which never
  fires `dragstart` from a touch) is gone; each via row carries ▲▼ buttons at
  `iconBtn("responsive")`, shown only once there are two vias to reorder. Also
  the first keyboard-operable reordering the field has had.
- **5 — touch targets.** 44pt floors (`min-h-11`, `w-11 h-11`) across the mobile
  paths, `md:`-reset so desktop keeps its density.
- **6 — the menu is a menu.** `MobileMenuSheet` (full height, behind the
  hamburger) replaced the `MobileMenuPanel` chip strip. Auth forms, both
  articles, the region switch and the layer switches are all in it; the navbar
  keeps title + auth / share / hamburger icon buttons.
- **7 — progress box collapses** to a percentage pill on mobile
  (`MapProgressBox`, now shared with the public map), and its layer checkboxes
  became `ToggleSwitch`es that live in the menu.
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

Suggested order for the rest: **3**, then the rest. Section 12 (installable app)
is independent and can be done at any point — it is also the cheapest way to get
the app onto a home screen, and worth having whether or not the native app in
`MOBILE_APP_PLAN.md` happens.

---

## 2. Bottom sheet — mechanics done, **looks wrong**

Done: `MobileBottomSheet.tsx` replaced the fixed top `h-1/2` drawer. Bottom
anchored, drag handle, four snaps (collapsed / peek 120px / half / 90%), tap the
handle to cycle, ArrowUp/ArrowDown to step. It is a flex sibling of the map
rather than an overlay, so the map's bottom furniture stays visible above it.
`map.resize()` fires once per settled height.

**Still to do — the visual design.** The behaviour is right and the thing is
still ugly. Open questions:

- The sheet is a plain white box with a square top edge and a grey bar; it does
  not read as a sheet. Rounded top corners, a real shadow, and a top edge that
  separates it from the map.
- The handle is an empty band above the content — a lot of vertical
  space in a pane that has none to spare, and it does not look draggable.
- The collapsed snap leaves a bare handle bar sitting on the map with nothing to
  say what it opens.
- No visual feedback while dragging, and no dimming or backdrop at the 90% snap,
  so a nearly-full sheet still reads as "map with a box on it".
- The seam where the sheet meets the map at the peek snap is where the MapLibre
  attribution and the collapsed progress pill now crowd together.

## 3. Hover-only popups on a touch device

Route and station popups are bound to `mousemove` (the `mousemove` handlers near
the bottom of `setupUserMapInteractions`,
`src/lib/map/interactions/userMapInteractions.ts`). iOS synthesizes a mousemove
on tap so this half-works, but:

- the popup and the route selection both happen on the same tap;
- the popup body says *"double-click to open"*, which is a strange instruction on
  a phone — and the `dblclick` handler calls `preventDefault()`, so users lose
  double-tap-to-zoom on any route.

What touch wants: one tap → a small info sheet carrying the route name, the
badges, and **buttons** ("Add to selection", "Open website"). That also makes the
`dblclick` handler unnecessary on touch.

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
