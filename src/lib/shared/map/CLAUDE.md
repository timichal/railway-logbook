# Map: what it draws (both apps)

This folder is shared with the native app, so a decision about what the map draws is made once here. The web map's own notes are in `src/lib/map/CLAUDE.md`.

## Styling

- `style.ts` is the **single source of truth** for colours, widths and opacities (`COLORS`, `WIDTHS`, `CIRCLES`, `LABELS`, `OPACITIES`). Route colour = visit status × line_class; width is one z4→z7 interpolate. An invisible wide `railway_routes_click` layer (every shown usage type, `clickBufferFilter`) gives touch hit areas.
- Route layer ids come from `layers.ts` (`routeLineLayerId`, `REGULAR_ROUTE_LAYER_ID`, `ROUTE_LINE_LAYERS`, `ROUTE_CLICK_LAYER_ID`). Never write them out anywhere else.
- **The colour expression: no `["all", ...]` in data-driven paint.** MapLibre Native's React binding crashes (`std::bad_alloc`) converting a `case` with an `all` condition beside another branch. Write nested single-condition `case`s and use `match` for a value fan-out (`utils/userRouteStyling.ts`, `lineClassColorExpression`). The admin map follows the same rule, though only the web draws it.
- **Scenic lines** (`createScenicLinesLayer`): a soft violet band under the route lines, from `scenic_lines_tile` (simplified to about a pixel per zoom). On the user map the band is off by default behind the "Scenic lines" switch, which exists only where `hasScenicHighlight`, and it follows the country filter through `scenicLinesFilter`.
- Each usage type has its own line layer (`railway_routes`, `_heritage` dotted, `_special` dashed), because `line-dasharray` isn't data-driven.
- Dark mode: the layers chosen to stand out against the basemap follow the scheme. That means stations (`COLORS.stationsDark`) and the user map's visit states (`routeColors(theme)` through `userRouteLayerConfigs(theme)`: three hues, with highspeed lighter rather than darker). The admin map keeps the light palette. Popup badges carry a `dark` pair.
- Zoom ranges: `ZOOM_RANGES` in `zoomRanges.ts`. Its header lists what else must match.
- **An MVT property is a scalar**: `frequency` and `other_names` arrive as Postgres array literals. Decode them with `parsePgTextArray` / `parseTextArray` (`routeFeature.ts`), never `split(",")`.
- Tile URL templates (`tileSources.ts`) take the tile host as an argument. Query strings are built by hand, for RN.

## Basemap (`basemap.ts`)

- OpenFreeMap `liberty` (`dark` in dark mode). It is vector so that the labels can be rewritten to Latin script (`latinizeLabels`: `coalesce(name:latin, name_en, name)` on layers that _read_ a name). On top of it, each explained in the file: the fade layer, admin_level 2 borders redrawn above the fade, POI layers dropped (`dropPoiLayers`), missing icons backfilled (web: `src/lib/map/missingIcons.ts`), buildings flattened (`flattenBuildings`). Park label points are filtered out of `park_outline` (`filterPointsFromParkOutlines`). Liberty's `park_outline` is an unfiltered `line` layer over a source-layer that also carries a label point per park, which MapLibre Native logs as "Invalid geometry in line layer".
- The style is fetched **before** the map is created (`loadBasemapStyle`, memoised). It resolves null on failure or after a 6s timeout, which falls back to OSM raster. Never call `setStyle` later, because it discards our layers. Never mutate the memoised layer objects.
- **Station labels are ours** (`createStationLabelsLayer`, `LABELS.station`, styled after openstreetmap-carto). Keep the halo translucent.
- **`text-font` must name exactly one font.** MapLibre joins the array into one glyph URL, which OpenFreeMap 404s, and the text silently falls back to a system font. Text also needs `glyphs`; the raster fallback declares `GLYPHS_URL`.

## Highlights and overlays

- Selection colours: Route Logger orange `#ff6b35`, Journey Planner gold `#FFD700`, My Trips orange.
- A highlight set is split by usage type (`highlightVariants`, `highlightLayers.ts`) and reuses the base layer's width and dash. The non-regular variants get a translucent solid casing underneath. The casings are in `HIGHLIGHT_LAYER_IDS`, which gives Heritage/Special routes their hit area. Highlights ignore the layer switches.
- Routes covered only in part get their overlay from a per-set `<baseId>_partial` GeoJSON source rather than the tile (`PartialRouteGeometry`, carrying `usage_type`). That covers the planner result, the Route Logger selection while `partial` is ticked, and an opened journey's or trip's logged stretches (a trip's are the union of its journeys'). The source is split by usage type with the same widths, dashes and casings (`createPartialHighlightLayers`). Empty it with `setData`, never remove it. A stretch carries only the route id, so a tap is hit-tested through `PARTIAL_HIGHLIGHT_LAYER_IDS` and the route is read from the tile. A route ticked partial with no known stretch is highlighted whole.
- **Ridden stretches** (`coverageLayer.ts`) are drawn green over the route from a `logged_coverage` GeoJSON source: one layer per usage type, moved before `stations`, repeating the route layers' usage and country filters.
- **Never `simplify` an overlay**: the stretches are drawn over the route's own line. The line tiles are simplified only by one tile unit (see `database/CLAUDE.md`).

## Layer prefs (`layerPrefs.ts`)

The stored form and how it resolves per region. The Special and Regular switches are stored per region, and `showRegular` exists only where `hasOrdinaryNonRegular`. `switchableUsageTypes` decides which switches a region has. The Special layer's default follows `ordinaryUsageTypes`.
