# Map: the web app's

What the map draws is decided in `src/lib/shared/map/` (its CLAUDE.md has the styling, basemap and highlight rules). This folder is the web map's alone. `index.ts` binds the tile hosts from `window.location` at module load, so never import it from RN.

## Map lifecycle

- The map is built once per region and colour scheme, never rebuilt for a refresh. Refresh route tiles with `setTiles` on the existing source (`useSourceTileRefresh`, driven by `useUserMap` and keyed on the URL's inputs). Never remove and re-add the layers: they would land above the station labels and lose their state.
- `useMapLibre` loads the basemap style before creating the map. The attribution starts collapsed (`addAttribution`). The map never rotates, by touch either.
- **Clear a highlight by filtering its layers to nothing, never by removing them** (`syncHighlightOverlay` in `useRouteHighlighting`). MapLibre keeps parsed tile features per layer id, so a re-added layer flashes the old ones.
- `useCoverageOverlay`: sync as soon as the data arrives. Don't gate on `isStyleLoaded()`.
- An anonymous visitor's rides are feature state (`useLocalRouteFeatureStates`), cleared on login.
- **The map shows only the open sidebar tab's highlights** (`TAB_HIGHLIGHT_KIND`: `planner` ↔ Route Logger, `view` ↔ My Trips). Map clicks act only in the Route Logger tab.

## Opening something flies to it

`{ fit: true }`, the fourth argument of `HighlightRoutesFn`, uses a bbox from the server limited to the region (`routeBoundsByIds`). For a plan the box is widened by the stretch travelled. Each transport gets the box from one query (`journeyWithBoundsForUser`, `tripWithBoundsForUser`, `planJourney`); local journeys use `getRoutesBounds`. The fit happens only on open, and any later highlight or camera move drops a pending fit, except the `sheetPadding` jump. `fitCamera.ts` keeps clear of the progress box and the sheet, capped by `FIT_MAX_ZOOM`.

## Popups

- **Popups are raw HTML** (`setHTML`). Every interpolated value goes through `escapeHtml()` and every URL through `safeHref()` (`utils/tooltipFormatting.ts`). Station names come from OSM, i.e. from third parties.
- Popup inline styles read `var(--color-…)`, since no stylesheet can reach them. Badges are written as a light fallback, then CSS `light-dark()`.
- Popups get `z-index: 30` in `globals.css`: under the toasts (50), over the map furniture.
- Hover: `interactions/mapHover.ts`, registered per layer with `hover.layer(id, { buildBody, click })`. Each move is settled once, the topmost layer in the style wins, and `click` must say what the click handlers do there. Never drive a popup from `mouseenter`/`mouseleave`, which fire once per layer, not per feature.
- Every hit test of both maps' click handlers is in `featuresAt.ts` (`ROUTE_HIT_LAYERS`).

## Touch interactions (`interactions/userMapInteractions.ts`)

- **A map click never inherits `partial`**: it selects with `partial: null`. A station wins over the route under it.
- **Touch gets a sheet, not a hover popup.** The mode is decided per interaction by `lastPointerWasTouch`, not by screen width. On touch, a tap opens the feature's sheet with buttons (Add to selection / Open website) instead of acting, and the double-click handler stands down.
- A sheet with an action is placed so its button sits under the finger (`anchor: "center"` + a measured offset). It has no ×, because every tap ends it.
- `sheetTookThisClick` is consulted first by every click handler. It tells sheet taps from map taps by the sheet's rect, swallows taps for `SHEET_TAP_GRACE_MS` (400ms) around opening and closing, and suspends double-click zoom meanwhile. MapLibre's `closeOnClick` stays off.
- `useUserMapInteractions` attaches the handlers **once per map** and reads the callbacks through `useEffectEvent`. It cancels a setup deferred to `"idle"` on teardown. A sheet therefore outlives callback changes, so its button asks `routeTapAction` again before acting.
- The button says what it will do ("Add to selection", "Remove from journey"…) via `routeTapAction` and a journey card's `isRouteInJourney` (`JourneyEditStartFn`).
- The shared map is read-only by calling `useUserMapInteractions` without `onRouteClick`.

## Line search highlight

In `hasRouteNames` regions, a picked line fits the map and is highlighted as a blue band drawn from its own GeoJSON (`getLineGeometry`). Each map's `useLineSearchHighlight` owns it, and a chip under the search box clears it.
