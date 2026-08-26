# Mobile UI — fix list

Findings from a read of the mobile paths (`MainLayout`, `VectorRailwayMap`,
`UserSidebar`, `MobileMenuPanel`, `JourneyLogger`, `JourneyPlanner`,
`useIsMobile`, `globals.css`), plus the installable-web-app work that belongs
with them.

Suggested order: **1 → 2 → 5 → 3**, then the rest. The first two are what make
the app *feel* wrong on a phone; 5 and 3 are what make it frustrating to actually
use. Section 12 (installable app) is independent and can be done at any point —
it is also the cheapest way to get the app onto a home screen, and worth having
whether or not the native app in `MOBILE_APP_PLAN.md` happens.

---

## 1. Layout flash on every mobile load

`src/hooks/useIsMobile.ts:4` starts at `false` and only corrects inside an
effect. `useResizableSidebar` then seeds `sidebarOpen = !isMobile`, so it also
starts `true`. The result on a phone: the **desktop** layout paints first — a
600px sidebar beside the map — then flips to the drawer, closes it, and runs
`map.resize()`. Two reflows and a map resize on every load.

Fix, either:

- do the breakpoint in CSS (`md:` classes on the sidebar and drawer wrappers) so
  the first paint is correct with no JS involved; or
- read `matchMedia` through `useSyncExternalStore` with a server snapshot.

The CSS route is preferable — it also removes `isMobile` from the props chain
that currently runs `MainLayout` → `VectorRailwayMap` → `UserSidebar`.

## 2. The drawer is on top and takes exactly half the screen

`VectorRailwayMap.tsx:509` — `h-1/2`, fixed. After the navbar that leaves ~290px
of map on an iPhone SE, and there is no way to change it: the resizer is
mouse-only (`useResizableSidebar.handleMouseDown` returns early when `isMobile`).

Replace with a **bottom** sheet with a drag handle and snap points (peek ~120px /
half / ~90%). Bottom rather than top for two reasons: that is where the thumb is,
and a sheet growing upward does not cover the part of the map that was just
tapped.

Most of the plumbing exists — the `slide-in-top` keyframes in `globals.css` just
gain a sibling, and `map.resize()` already fires on the sidebar toggle
(`VectorRailwayMap.tsx:458-466`).

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

## 4. Via-station reordering does not work on mobile at all

`src/components/JourneyPlanner.tsx:420` uses HTML5 `draggable` + `dragstart`. iOS
Safari does not fire those from touch, so the `☰` handle is dead — silently. Add
▲▼ buttons (or move to pointer events). The handle is also only ~16px of tap
target.

## 5. Touch targets are well under 44pt throughout

Apple's floor is 44×44pt; Android's is 48dp. Current state:

| Element | Where | Size |
| --- | --- | --- |
| Partial checkbox | `JourneyLogger.tsx:231` | `w-3 h-3` = 12px |
| Route-remove `×` | `JourneyLogger.tsx`, selected-routes list | bare glyph, no padding |
| Progress-box checkboxes (×3) | `VectorRailwayMap.tsx:531-580` | `w-3 h-3` |
| Tab bar | `UserSidebar.tsx` | `py-2 px-2 text-xs` |
| Menu chips (×6) | `MobileMenuPanel.tsx` | `py-1.5 px-3 text-xs`, wrapping |

Wrapping each checkbox in a `p-2` label and giving `×` a `p-2 -m-2` hit area
costs nothing visually.

## 6. `MobileMenuPanel` is inside the scroll area, not a menu

It is a permanent two-row chip strip at the top of a half-screen sheet, and
Login/Register expand **inline** below it (`MobileMenuPanel.tsx:104-117`) — so
signing in on a phone means scrolling a form inside a ~300px pane.

This should be what the hamburger actually opens: a full-height sheet or modal,
separate from the tab content.

## 7. The progress box never collapses

On mobile it is pinned at `bottom-10 left-3` with three always-visible
checkboxes, permanently eating a corner of an already-short map
(`VectorRailwayMap.tsx:531-580`; the same block is in
`PublicRailwayMap.tsx:170-220`).

`AdminLayerControls` already solved this — `const [collapsed, setCollapsed] =
useState(isMobile)` at `AdminLayerControls.tsx:32`. Reuse the pattern: collapse
to a `42%` pill that expands on tap.

## 8. No safe-area handling

`h-dvh` covers the dynamic toolbar, but `layout.tsx:21-24` has no
`viewportFit: "cover"`, so `env(safe-area-inset-*)` resolves to 0 and cannot be
opted into later. On a home-indicator iPhone the `bottom-10` overlays sit close
to the indicator, as does the toast at `bottom-16`
(`src/lib/toast/ToastContainer.tsx:50`).

## 9. The Geist fonts are downloaded and never used

`globals.css:25` sets `body { font-family: Arial, Helvetica, sans-serif }`, which
beats the `--font-geist-sans` variable — and nothing in the app applies the
`font-sans` utility that would pick it up. So two Google Fonts are fetched on
every load and Helvetica renders on iOS.

One-line fix: `font-family: var(--font-geist-sans), system-ui, sans-serif`.

## 10. Dark mode is dead code

`globals.css:17-21` defines dark `--background` / `--foreground`, then `body`
hardcodes `#ffffff` and every component is `bg-white` / `text-black`. On a phone
at night this is a floodlight. Either commit to dark mode or delete the variables
so it stops reading as supported.

## 11. Suggestion lists use the blur/200ms race

Both the map search (`VectorRailwayMap.tsx`, `onBlur` → `setTimeout(…, 200)`) and
`StationSearchInput` (via `JourneyPlanner`'s `onBlur` handlers) close on a timer.
On touch, scrolling the suggestion list blurs the input and the tap lands on
nothing — the classic "tapped it, nothing happened". Select on `pointerdown`
instead of relying on the timer.

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
- [ ] **`viewportFit: "cover"`** in the `viewport` export (`layout.tsx:21-24`) —
      required before any `env(safe-area-inset-*)` in item 8 does anything.
- [ ] **Service worker** for the app shell. Keep it conservative: cache the shell
      and static assets, leave tile and API requests network-first. Caching MVT
      tiles is tempting but it is not the same thing as offline maps (see the
      plan doc), and a stale route tile shows wrong visit colours.
- [ ] **Verify standalone mode.** `h-dvh` behaves differently without browser
      chrome; check the sheet from item 2 and the bottom overlays in item 8 once
      installed, not just in Safari.
