/**
 * The railway map.
 *
 * Every layer, colour, width, dash pattern and label rule is the web app's, imported
 * from `@shared/map/*` rather than reproduced — `style.ts` stays the single source of
 * truth and the two apps cannot drift into looking different. What is rewritten is
 * the *mechanism*: the web app's hooks call `map.addLayer` / `setFilter` /
 * `setLayoutProperty` on a live map, and here the same layers are `<Layer>` children
 * whose props are re-rendered. Layer specifications and `<Layer>` props are the same
 * type (both come from `@maplibre/maplibre-gl-style-spec`), so a spec spreads
 * straight into a component.
 *
 * Three things Phase 0 established that this file is built around:
 *
 * - **A toggle is a mounted child, not a `visibility` property.** The specs come out
 *   of the factories with `visibility: "none"` for the three optional layers, since
 *   that is what the web app's imperative toggles expect; here the layer is simply
 *   not rendered when it is off, and built with `visible: true` when it is on.
 *   The Regular layer is the exception (see `routeLayers`).
 * - **`initialViewState` is initial and nothing else** — it cannot move the camera
 *   later, and remounting the `<Camera>` does not reset it. So the saved position is
 *   read *before* the map mounts, and a region switch moves the camera through
 *   `cameraRef.setStop`, which is what a stop is for.
 * - **`LngLatBounds` is flat** `[west, south, east, north]`, where the web app's
 *   `region.bounds` is nested `[[w, s], [e, n]]`.
 *
 * `Map` is imported under an alias only because it shadows the global of that name,
 * which the linter rightly objects to; the component really is called `Map` in v11
 * (it was `MapView` in the docs you will find).
 *
 * The click-buffer layer has no counterpart: a press is delivered by each
 * `<VectorSource>`'s own `onPress` with a 44×44pt hitbox, and the topmost layer in
 * the hitbox wins — which gives the note-beats-station-beats-route precedence the web
 * app hand-codes with `queryRenderedFeatures`.
 */

import type { LineLayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  type PressEventWithFeatures,
  VectorSource,
  type ViewStateChangeEvent,
} from "@maplibre/maplibre-react-native";
import { COVERAGE_LAYER_IDS } from "@shared/map/coverageLayer";
import {
  createLineSearchHighlightLayer,
  HIGHLIGHT_COLORS,
  LINE_SEARCH_HIGHLIGHT_LAYER_ID,
  LINE_SEARCH_HIGHLIGHT_SOURCE_ID,
  LINE_SEARCH_HIGHLIGHT_TOLERANCE,
  lineSearchHighlightData,
} from "@shared/map/highlightLayers";
import {
  createPublicNotesLayer,
  createRouteLineLayer,
  createScenicLinesLayer,
  createStationLabelsLayer,
  createStationsLayer,
  REGULAR_ROUTE_LAYER_ID,
} from "@shared/map/layers";
import {
  scenicLinesFilter,
  shownUsageTypes,
  userRouteLayerConfigs,
  userRoutesFilter,
} from "@shared/map/userMapLayers";
import { REGIONS, type RegionId } from "@shared/regions";
import type { LineSearchResult, RailwayRoute, Station } from "@shared/types";
import { useIsFocused, useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayoutChangeEvent, NativeSyntheticEvent } from "react-native";
import { ActivityIndicator, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NetworkError, READ_TIMEOUT_MS } from "@/api/client";
import { useHighlight } from "@/logbook/HighlightContext";
import { type PlannerEnd, usePlanner } from "@/logbook/PlannerContext";
import { plannerSheetCover } from "@/logbook/plannerSheet";
import { useSelection } from "@/logbook/SelectionContext";
import { CoverageOverlay } from "@/map/CoverageOverlay";
import { FeatureSheet, RAISED_GAP } from "@/map/FeatureSheet";
import { type FitPadding, fitCamera } from "@/map/fitCamera";
import { HighlightLayers, PartialHighlightSource } from "@/map/HighlightOverlay";
import { useLayerPrefs } from "@/map/LayerPrefsContext";
import { MapNotice, type MapNoticeContent } from "@/map/MapNotice";
import { CHIP_ROW_HEIGHT, MapTopControls, TOP_CONTROLS_GAP } from "@/map/MapTopControls";
import {
  lastJourneyOf,
  type MapFeature,
  routeFeatureFromMetadata,
  toNoteFeature,
  toRouteTrackId,
  toStationFeature,
} from "@/map/mapFeatures";
import { loadMapPosition, type MapPosition, saveMapPosition } from "@/map/mapPosition";
import { PLANNER_BUTTON_HEIGHT } from "@/map/PlannerButton";
import { heldRouteMetadata, readRouteMetadata } from "@/map/routeMetadataCache";
import {
  notesTileUrl,
  routesTileUrl,
  scenicTileUrl,
  stationsTileUrl,
  ZOOM_RANGES,
} from "@/map/tileUrls";
import { useBasemapStyle } from "@/map/useBasemapStyle";
import { useLineHighlight } from "@/map/useLineHighlight";
import { useRides } from "@/map/useRides";
import { useRoutesTileVersion } from "@/map/useRoutesTileVersion";
import { useRegion } from "@/region/RegionContext";
import { useTheme } from "@/theme/ThemeContext";

/** The map's own zoom limits, as `useMapLibre` sets them on the web. */
const MIN_ZOOM = 4;
const MAX_ZOOM = 18;

/** How long a settled camera waits before its position is written down. */
const SAVE_DEBOUNCE_MS = 500;

/** Where a station picked out of the search box lands, as on the web. */
const STATION_ZOOM = 14;
const STATION_FLY_MS = 1200;

/**
 * Fitting an opened journey, trip or plan, or a searched line: clear of the
 * furniture over the map — the top row (`MapTopControls`, 44pt controls 8pt in), the
 * progress box and the planner button along the bottom, and the searched line's chip
 * under the top row while it is up — by a gap, and of the sides by the web's mobile
 * margin. The attribution's small button sits above the planner button, and may
 * overlap a fitted path's corner.
 */
const CONTROL_EDGE = 8 + 44;
/** The bottom edge's tallest: the planner button, 8pt in (`PlannerButton`). */
const BOTTOM_CONTROL_EDGE = 8 + PLANNER_BUTTON_HEIGHT;
const FIT_GAP = 16;
const FIT_SIDE_MARGIN = 24;
const FIT_FLY_MS = 1000;
/**
 * The least a route's sheet raised above the planner's is given, where the map pane
 * is short (a small phone, a tall selection bar): it may then run under the top row,
 * which beats a sheet cut down to nothing.
 */
const RAISED_SHEET_MIN_HEIGHT = 160;

/** `plannerCover`: how much of the map's bottom the planner's sheet covers, or 0. */
function fitPadding(insetTop: number, withChips: boolean, plannerCover: number): FitPadding {
  const chipRow = withChips ? TOP_CONTROLS_GAP + CHIP_ROW_HEIGHT : 0;
  return {
    top: insetTop + CONTROL_EDGE + chipRow + FIT_GAP,
    right: FIT_SIDE_MARGIN,
    // Over the planner's sheet the progress box is hidden, so only the gap is left
    bottom: (plannerCover > 0 ? plannerCover : BOTTOM_CONTROL_EDGE) + FIT_GAP,
    left: FIT_SIDE_MARGIN,
  };
}

const NO_CONNECTION_NOTICE: MapNoticeContent = {
  kind: "offline",
  message: "No connection. Only routes opened earlier in this session can be shown offline.",
};
const ROUTE_FAILED_NOTICE: MapNoticeContent = {
  kind: "error",
  message: "Couldn't load this route.",
};

interface RailwayMapProps {
  /** The country filter, already resolved for this region (`useEffectiveCountries`). */
  countries: string[];
  /**
   * Furniture over the map's bottom corners (the progress box): drawn over the map
   * and under the feature sheet and the notice, which would otherwise open beneath it.
   */
  children?: ReactNode;
}

/** `region.bounds` is `[[w, s], [e, n]]`; the binding wants `[w, s, e, n]`. */
function flatBounds(regionId: RegionId): [number, number, number, number] {
  const [[west, south], [east, north]] = REGIONS[regionId].bounds;
  return [west, south, east, north];
}

export function RailwayMap({ countries, children }: RailwayMapProps): ReactNode {
  const { resolved: theme } = useTheme();
  const { showRegular, showHeritage, showSpecial, showScenicLines, showClosed } = useLayerPrefs();
  // The user's rides, coloured and ordered over Martin's tile by id. None yet (or
  // none to be had): no route lines, rather than every route drawn unridden.
  const rides = useRides();
  // Puts the route source on Martin's cached tile; null until it is known
  const tileVersion = useRoutesTileVersion();
  // Built once per scheme, countries, switches and rides rather than on every
  // render, which would hand each <Layer> a new paint object. The country filter is
  // the layers', as on the web, so the tile URL is the same for everyone and Martin
  // caches one copy. The closed lines the user rode stay whatever the switch says
  // (closedRoutesFilter).
  const routeLayers = useMemo(() => {
    if (!rides) return null;
    const configs = userRouteLayerConfigs(theme, undefined, rides);
    const routesFilter = userRoutesFilter({
      countries,
      showClosed,
      riddenClosed: rides.closed,
    });
    return {
      route: createRouteLineLayer(0, { ...configs.route, routesFilter }),
      heritage: createRouteLineLayer(1, { ...configs.heritage, visible: true, routesFilter }),
      special: createRouteLineLayer(2, { ...configs.special, visible: true, routesFilter }),
    };
  }, [theme, countries, showClosed, rides]);
  // The Regular layer is the one switch that is a `visibility` rather than an absent
  // child: it is the scenic band's `beforeId`, and an anchor that isn't there would
  // send the band to the top of the map. It is switched off only where Regular is
  // not the only ordinary type (Japan's JR lines, ticked in Statistics). Laid over
  // the built spec here, so the switch restyles this one layer and not all three.
  const regularLayout = useMemo((): LineLayerSpecification["layout"] => {
    if (!routeLayers) return undefined;
    return { ...routeLayers.route.layout, visibility: showRegular ? "visible" : "none" };
  }, [routeLayers, showRegular]);
  // Read by a press, which must not be rebuilt whenever the rides change
  const ridesRef = useRef(rides);
  ridesRef.current = rides;
  const { regionId } = useRegion();
  const { selected } = useSelection();
  const highlighted = useHighlight();

  const basemapStyle = useBasemapStyle(theme);
  // Memoised: a new array each render would be sent across to the native layer again
  const scenicFilter = useMemo(() => scenicLinesFilter(countries), [countries]);
  // What the ridden stretches follow
  const shownTypes = useMemo(
    () => shownUsageTypes({ showRegular, showHeritage, showSpecial }),
    [showRegular, showHeritage, showSpecial],
  );
  const initialPosition = useInitialPosition(regionId);
  // The line picked in the search box, drawn as a band under the route lines
  const lineHighlight = useLineHighlight(regionId, shownTypes);
  const { setLine } = lineHighlight;
  const lineBandData = useMemo(
    () => lineSearchHighlightData(lineHighlight.geometry ?? []),
    [lineHighlight.geometry],
  );
  const lineBandLayer = useMemo(
    () => createLineSearchHighlightLayer(shownTypes, theme),
    [shownTypes, theme],
  );

  const cameraRef = useRef<CameraRef>(null);
  const [feature, setFeature] = useState<MapFeature | null>(null);
  // A tap that could not be answered, shown where its sheet would have opened
  const [notice, setNotice] = useState<MapNoticeContent | null>(null);
  // The route read in flight, aborted by the next route press
  const routeRead = useRef<AbortController | null>(null);
  // Every press counts itself, so a route's sheet whose details arrive after a
  // later press (another feature, the map's dismissal, a region switch) is dropped.
  const pressRef = useRef(0);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // The open feature sheet's height, measured; read only while one is open
  const [sheetHeight, setSheetHeight] = useState(0);
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const router = useRouter();
  const { height: windowHeight } = useWindowDimensions();
  const { sheetOpen: plannerOpen, placeFromMap, pickOnMap } = usePlanner();
  // The planner's sheet covers the lower half of the map and leaves the rest live, so
  // the map is in view under it too: fits wait for neither, and aim above it
  const inView = isFocused || plannerOpen;
  const plannerCover =
    plannerOpen && size ? plannerSheetCover(size.height, windowHeight, insets.top) : 0;
  // Read by a station's planning, which must not be rebuilt as the sheet opens
  const plannerOpenRef = useRef(plannerOpen);
  plannerOpenRef.current = plannerOpen;

  /**
   * Where the camera is *now*, as opposed to where it started.
   *
   * A region switch moves the camera with a stop, so the map is built once — but a
   * **theme switch rebuilds it**, because the basemap style is a different style
   * object and MapLibre takes one at construction (the same trade `useMapLibre`
   * makes on the web). A rebuilt map reads `initialViewState` again, and reading the
   * *initial* position there would throw away wherever the reader had panned to. So
   * the camera's own position is kept as it changes and is what the next mount
   * starts from.
   */
  const position = useRef<MapPosition | null>(null);
  position.current ??= initialPosition;

  const mountedRegion = useRef(regionId);
  useEffect(() => {
    if (mountedRegion.current === regionId) return;
    mountedRegion.current = regionId;
    pressRef.current++;
    setFeature(null);
    setNotice(null);

    // Nothing picked out of the old region survives into the new one, and neither
    // does the camera: `initialViewState` cannot be revisited, so this is a stop.
    // Cancelled by the next switch, so two quick ones cannot land out of order.
    let cancelled = false;
    void loadMapPosition(regionId).then((saved) => {
      if (cancelled) return;
      const region = REGIONS[regionId];
      const next = saved ?? { center: region.center, zoom: region.zoom };
      position.current = next;
      cameraRef.current?.setStop({ ...next, duration: 0 });
    });
    return () => {
      cancelled = true;
    };
  }, [regionId]);

  /**
   * Flying to what the logbook or the planner just opened (`pendingFit`, see
   * `HighlightContext`). Both ask from somewhere else — another tab, a modal over
   * this one — so the move waits until the map is in view, where it can be seen
   * landing, and until the map is measured and its style loaded: a stop sent to a
   * map still being built can be lost under its `initialViewState`. The ask is
   * settled only once the binding has taken the stop; one it refuses stays asked,
   * and is tried again on the next change here.
   */
  const { bounds: fitBounds, pendingFit, fitDone } = highlighted;
  const [loadedStyle, setLoadedStyle] = useState<typeof basemapStyle>(null);
  useEffect(() => {
    if (pendingFit === null || !fitBounds) return;
    if (!inView || !size || !basemapStyle || loadedStyle !== basemapStyle) return;

    // A highlight fitted to has its chip up, so the chip row is always reserved
    const padding = fitPadding(insets.top, true, plannerCover);
    try {
      cameraRef.current
        ?.setStop({ ...fitCamera(fitBounds, size, padding, MIN_ZOOM), duration: FIT_FLY_MS })
        .then(
          () => fitDone(pendingFit),
          () => {},
        );
    } catch {
      // The native camera isn't there yet (`setStop` throws rather than rejects)
    }
  }, [
    pendingFit,
    fitBounds,
    fitDone,
    inView,
    size,
    basemapStyle,
    loadedStyle,
    insets.top,
    plannerCover,
  ]);

  // A line picked in the search box: the whole line in view, as an opened journey
  // is fitted, and its band drawn once the geometry arrives. The map is on screen
  // (the box is over it), so unlike `pendingFit` there is nothing to wait for.
  const selectLine = useCallback(
    (line: LineSearchResult) => {
      setLine(line);
      if (!size) return;
      try {
        cameraRef.current
          ?.setStop({
            ...fitCamera(line.bounds, size, fitPadding(insets.top, true, plannerCover), MIN_ZOOM),
            duration: FIT_FLY_MS,
          })
          .catch(() => {});
      } catch {
        // The native camera isn't there yet (`setStop` throws rather than rejects)
      }
    },
    [setLine, size, insets.top, plannerCover],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((prev) =>
      prev && prev.width === width && prev.height === height ? prev : { width, height },
    );
  }, []);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRegionDidChange = useCallback((event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    const { center, zoom } = event.nativeEvent;
    const region = mountedRegion.current;
    const next: MapPosition = { center: [center[0], center[1]], zoom };
    position.current = next;
    // Written down on a delay, because this fires at the end of every pan; held in
    // the ref immediately, because a rebuild can happen between two pans.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveMapPosition(region, next), SAVE_DEBOUNCE_MS);
  }, []);
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  // Martin's tile, the same for everyone: the colours are the rides and the country
  // filter the layers, laid over it. Under its version (cached), or the uncached one
  // while there is no version to be had
  const routesUrl = useMemo(() => {
    if (tileVersion === null) return null;
    return routesTileUrl(tileVersion === undefined ? {} : { version: tileVersion });
  }, [tileVersion]);

  const selectedIds = useMemo(() => selected.map((s) => s.route.trackId), [selected]);
  // A partial route's stretch is drawn in place of the whole route, as the web app's
  // selection highlight does.
  const selectedPartials = useMemo(
    // A stretch too short to draw (a journey's, cut to under two points) is left
    // out, and its route drawn whole: an empty line is nothing to hand the source
    () =>
      selected.flatMap((s) =>
        s.partial && s.covered && s.covered.coordinates.length >= 2 ? [s.covered] : [],
      ),
    [selected],
  );

  // A press on a source stops there rather than bubbling to the map, whose own
  // handler is the dismissal — otherwise the press that opened the sheet would close
  // it in the same gesture.
  const showFeature = useCallback((next: MapFeature | null) => {
    pressRef.current++;
    setFeature(next);
    setNotice(null);
  }, []);
  const closeNotice = useCallback(() => setNotice(null), []);
  // A station picked in the search is taken as a tap on it would be: into the
  // planner's target slot while that is open, otherwise its sheet, so a plan can start
  // from a station found by name (the sheet is short, and the camera centres the
  // station above it)
  const flyToStation = useCallback(
    (station: Station) => {
      const [lon, lat] = station.coordinates;
      cameraRef.current?.setStop({
        center: [lon, lat],
        zoom: STATION_ZOOM,
        duration: STATION_FLY_MS,
      });
      if (plannerOpenRef.current) {
        showFeature(null);
        pickOnMap(station);
      } else {
        showFeature({ kind: "station", name: station.name, station });
      }
    },
    [showFeature, pickOnMap],
  );
  // A station placed into the planner from its sheet opens the planner over the
  // lower half of the map, where the form shows what is left and searches by itself
  // once both ends are in. An open planner is left as it is.
  const planFromStation = useCallback(
    (station: Station, end: PlannerEnd) => {
      showFeature(null);
      placeFromMap(station, end);
      if (!plannerOpenRef.current) router.push("/plan-journey");
    },
    [showFeature, placeFromMap, router],
  );
  // While the planner is open a station goes straight into its target slot, as a
  // click fills the web planner's focused field: a sheet with buttons over the
  // planner's would be one step too many, and the planner shows where it went.
  // Anything else, and a station with no usable id, opens its sheet as ever.
  const readStationPress = useCallback(
    (
      properties: Record<string, unknown> | null,
      geometry: GeoJSON.Geometry | null | undefined,
    ): MapFeature | null => {
      const station = toStationFeature(properties, geometry);
      if (!station?.station || !plannerOpenRef.current) return station;
      showFeature(null);
      pickOnMap(station.station);
      return null;
    },
    [showFeature, pickOnMap],
  );
  const takePress = useCallback(
    (
      event: NativeSyntheticEvent<PressEventWithFeatures>,
      read: (
        properties: Record<string, unknown> | null,
        geometry: GeoJSON.Geometry | null | undefined,
      ) => MapFeature | null,
    ) => {
      event.stopPropagation();
      const hit = event.nativeEvent.features[0];
      if (!hit) return;
      const next = read((hit.properties ?? null) as Record<string, unknown> | null, hit.geometry);
      if (next) showFeature(next);
    },
    [showFeature],
  );
  // The route tile carries only what the layers draw with, so the sheet's text
  // is read by id, and the last ride from the rides. A route read before this
  // session opens at once from what was kept (`routeMetadataCache.ts`) and is
  // refreshed by the read; otherwise nothing opens until the text is here — a sheet
  // without the route's name, or a selection made from one, is no use — and a read
  // that fails says so in place of the sheet.
  const takeRoutePress = useCallback(
    async (event: NativeSyntheticEvent<PressEventWithFeatures>) => {
      event.stopPropagation();
      const hit = event.nativeEvent.features[0];
      const trackId = hit ? toRouteTrackId(hit.id) : null;
      if (trackId === null) return;
      const press = ++pressRef.current;

      const open = (route: RailwayRoute) => {
        const lastJourney = lastJourneyOf(ridesRef.current?.byId.get(trackId));
        setFeature(routeFeatureFromMetadata(route, lastJourney));
        setNotice(null);
      };
      const fail = (next: MapNoticeContent) => {
        setFeature(null);
        setNotice(next);
      };

      const held = heldRouteMetadata(trackId);
      if (held) open(held);
      else setNotice(null);

      routeRead.current?.abort();
      const controller = new AbortController();
      routeRead.current = controller;
      const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
      let route: RailwayRoute | undefined;
      try {
        route = await readRouteMetadata(trackId, controller.signal);
      } catch (error) {
        // A newer press took over (and aborted this one), or the kept copy is showing
        // and stays
        if (press !== pressRef.current || held) return;
        console.warn("Route details failed:", error);
        // No connection, or one too stalled to answer in time
        const offline =
          error instanceof NetworkError || (error instanceof Error && error.name === "AbortError");
        fail(offline ? NO_CONNECTION_NOTICE : ROUTE_FAILED_NOTICE);
        return;
      } finally {
        clearTimeout(timeout);
        if (routeRead.current === controller) routeRead.current = null;
      }
      if (press !== pressRef.current) return;
      // The server doesn't know it (deleted since the tile was drawn)
      if (route) open(route);
      else fail(ROUTE_FAILED_NOTICE);
    },
    [],
  );

  if (!basemapStyle || !position.current) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-100 dark:bg-gray-900">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1" onLayout={handleLayout}>
      <MapLibreMap
        mapStyle={basemapStyle}
        style={{ flex: 1 }}
        // Rotation and pitch are off for the same reason as on the web: a railway map
        // is read flat and north-up, and both gestures only ever get triggered by
        // accident while panning.
        touchRotate={false}
        touchPitch={false}
        logo={false}
        compass={false}
        // Above the planner button, which has the bottom-right corner
        attributionPosition={{ bottom: BOTTOM_CONTROL_EDGE + 8, right: 8 }}
        onPress={() => showFeature(null)}
        onRegionDidChange={handleRegionDidChange}
        onDidFinishLoadingStyle={() => setLoadedStyle(basemapStyle)}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: position.current.center, zoom: position.current.zoom }}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          maxBounds={flatBounds(regionId)}
        />

        {/* The scenic band, under every route line and under the searched line's
            band, where the region offers it at all. `beforeId` because a layer
            mounted after the map has loaded (the toggle switched on) is otherwise
            appended to the very top — so it waits for its anchor, the searched
            line's band, which waits for the Regular route layer, which comes with
            the rides and the tile version (the binding holds a layer until its
            `beforeId` exists). A remounted route source re-adds that layer above
            both bands (before the coverage overlay), so the order holds after. */}
        <VectorSource
          id="scenic_lines"
          tiles={[scenicTileUrl()]}
          minzoom={ZOOM_RANGES.scenicLines.min}
          maxzoom={ZOOM_RANGES.scenicLines.max}
        >
          {showScenicLines && REGIONS[regionId].hasScenicHighlight && routeLayers && routesUrl ? (
            <Layer
              {...createScenicLinesLayer({ visible: true, theme })}
              filter={scenicFilter}
              beforeId={LINE_SEARCH_HIGHLIGHT_LAYER_ID}
            />
          ) : null}
        </VectorSource>

        {/* The searched line's band, directly under the route lines and above the
            scenic band, so the searched line wins where the two meet (as on the web).
            Mounted with the route lines and emptied rather than removed when no line
            is picked, as the coverage overlay is: the scenic band anchors on it, and
            an anchor that comes and goes would move the scenic band each time. */}
        {routeLayers && routesUrl ? (
          <GeoJSONSource
            id={LINE_SEARCH_HIGHLIGHT_SOURCE_ID}
            data={lineBandData}
            tolerance={LINE_SEARCH_HIGHLIGHT_TOLERANCE}
          >
            <Layer {...lineBandLayer} beforeId={REGULAR_ROUTE_LAYER_ID} />
          </GeoJSONSource>
        ) : null}

        {/* Keyed on its URL: the binding reads `tiles` once, when it builds the
            source, and a new URL handed to a built one is stored and never used — so
            the country filter would never reach the map. A new key is a new source.
            Which is also why every route layer carries a `beforeId`: a remounted
            source re-adds its layers (as do the rides, arriving after the map), and
            one without an anchor would be appended to the top, over the stations.
            Under the coverage overlay is where they belong, and it is mounted with
            the map. Not mounted at all until the tile version is known
            (`useRoutesTileVersion`): the uncached URL first would fetch every tile
            twice. */}
        {routesUrl ? (
          <VectorSource
            key={routesUrl}
            id="railway_routes"
            tiles={[routesUrl]}
            minzoom={ZOOM_RANGES.railwayRoutes.min}
            maxzoom={ZOOM_RANGES.railwayRoutes.max}
            onPress={takeRoutePress}
          >
            {/* Every child keyed: a source drops its null children and keys the rest
                by position (`cloneReactChildrenWithProps`), so a layer switched on
                would shift the ones after it into each other's places, and a
                `<Layer>` handed another's id throws ("`id` cannot be changed"). */}
            {routeLayers ? (
              <Layer
                key="route-regular"
                {...routeLayers.route}
                layout={regularLayout}
                beforeId={COVERAGE_LAYER_IDS[0]}
              />
            ) : null}
            {routeLayers && showHeritage ? (
              <Layer
                key="route-heritage"
                {...routeLayers.heritage}
                beforeId={COVERAGE_LAYER_IDS[0]}
              />
            ) : null}
            {routeLayers && showSpecial ? (
              <Layer
                key="route-special"
                {...routeLayers.special}
                beforeId={COVERAGE_LAYER_IDS[0]}
              />
            ) : null}
            {/* What the logbook or the planner pointed the map at — gold or orange. */}
            <HighlightLayers
              key="highlighted_routes"
              baseId="highlighted_routes"
              trackIds={highlighted.trackIds}
              partials={highlighted.partials}
              color={highlighted.color}
              beforeId="stations"
            />
            {/* The Route Logger selection, in the orange the web app uses for it.
                `beforeId` rather than mounting order: a set that appears after the map
                has loaded is otherwise appended to the very top, over the labels. */}
            <HighlightLayers
              key="selected_routes_highlight"
              baseId="selected_routes_highlight"
              trackIds={selectedIds}
              partials={selectedPartials}
              color={HIGHLIGHT_COLORS.view}
              beforeId="stations"
            />
          </VectorSource>
        ) : null}

        {/* The stretches already ridden of routes not yet finished, in the visited
            green over their own partial-orange line. Mounted here, with the map, so
            it settles below every highlight set — see `CoverageOverlay`. */}
        <CoverageOverlay
          countries={countries}
          shownTypes={shownTypes}
          theme={theme}
          hidden={rides === null}
        />

        <PartialHighlightSource
          baseId="highlighted_routes"
          partials={highlighted.partials}
          color={highlighted.color}
          beforeId="stations"
        />

        <PartialHighlightSource
          baseId="selected_routes_highlight"
          partials={selectedPartials}
          color={HIGHLIGHT_COLORS.view}
          beforeId="stations"
        />

        <VectorSource
          id="stations"
          tiles={[stationsTileUrl()]}
          minzoom={ZOOM_RANGES.stations.min}
          maxzoom={ZOOM_RANGES.stations.max}
          onPress={(event) => takePress(event, readStationPress)}
        >
          <Layer {...createStationsLayer(theme)} />
          <Layer {...createStationLabelsLayer(theme)} />
        </VectorSource>

        <VectorSource
          id="public_notes"
          tiles={[notesTileUrl()]}
          minzoom={ZOOM_RANGES.publicNotes.min}
          maxzoom={ZOOM_RANGES.publicNotes.max}
          onPress={(event) => takePress(event, toNoteFeature)}
        >
          <Layer {...createPublicNotesLayer()} />
        </VectorSource>
      </MapLibreMap>

      {/* A map runs under the status bar, so the furniture over it stands clear of
          one — which is the whole of why the map pane takes no safe-area inset. */}
      <MapTopControls
        onSelectStation={flyToStation}
        onSelectLine={selectLine}
        lineHighlight={lineHighlight}
        plannerCover={plannerCover}
      />
      {/* The progress box and the planner button ride above an open sheet rather than
          going under it: "Plan journey" is still the next step from a tapped route.
          Not while the planner is up: the raised sheet floats over the planner's own. */}
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: feature && plannerCover === 0 ? sheetHeight : 0,
        }}
      >
        {children}
      </View>

      {feature ? (
        <FeatureSheet
          feature={feature}
          regionId={regionId}
          bottom={plannerCover}
          // Raised, it keeps clear of the top row too
          maxHeight={
            plannerCover > 0 && size
              ? Math.max(
                  RAISED_SHEET_MIN_HEIGHT,
                  size.height -
                    plannerCover -
                    RAISED_GAP -
                    fitPadding(
                      insets.top,
                      lineHighlight.line !== null || highlighted.trackIds.length > 0,
                      plannerCover,
                    ).top,
                )
              : undefined
          }
          onHeight={setSheetHeight}
          onPlan={planFromStation}
          onClose={() => showFeature(null)}
        />
      ) : null}
      {notice ? <MapNotice notice={notice} bottom={plannerCover} onClose={closeNotice} /> : null}
    </View>
  );
}

/**
 * Where the camera starts: this region's saved position, or the region's own centre.
 *
 * Read before the map mounts rather than applied afterwards — `initialViewState` is
 * applied once from the map's first layout and there is no second chance at it, so a
 * position arriving late would simply be ignored.
 */
function useInitialPosition(regionId: RegionId): MapPosition | null {
  const [position, setPosition] = useState<MapPosition | null>(null);
  // Deliberately the *mounting* region and no other: a later switch is a camera stop,
  // and re-reading the saved position here would fight it. Held in a ref rather than
  // read from the argument so the effect has nothing to depend on.
  const mountedRegion = useRef(regionId);

  useEffect(() => {
    let cancelled = false;
    const region = REGIONS[mountedRegion.current];
    void loadMapPosition(region.id).then((saved) => {
      if (!cancelled) setPosition(saved ?? { center: region.center, zoom: region.zoom });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return position;
}
