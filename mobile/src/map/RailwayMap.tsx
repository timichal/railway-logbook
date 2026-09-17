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
 *   not rendered when it is off, and rendered `visible` when it is on.
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
import {
  Camera,
  type CameraRef,
  Layer,
  type LineLayerSpecification,
  Map as MapLibreMap,
  type PressEventWithFeatures,
  VectorSource,
  type ViewStateChangeEvent,
} from "@maplibre/maplibre-react-native";
import {
  createPublicNotesLayer,
  createRailwayRoutesHeritageLayer,
  createRailwayRoutesLayer,
  createRailwayRoutesSpecialLayer,
  createScenicRoutesOutlineLayer,
  createStationLabelsLayer,
  createStationsLayer,
} from "@shared/map/layers";
import {
  scenicOutlineFilter,
  userHeritageLayerConfig,
  userRouteLayerConfig,
  userScenicLayerConfig,
  userSpecialLayerConfig,
} from "@shared/map/userMapLayers";
import { REGIONS, type RegionId } from "@shared/regions";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NativeSyntheticEvent } from "react-native";
import { ActivityIndicator, View } from "react-native";
import { FeatureSheet } from "@/map/FeatureSheet";
import { useLayerPrefs } from "@/map/LayerPrefsContext";
import {
  type MapFeature,
  toNoteFeature,
  toRouteFeature,
  toStationFeature,
} from "@/map/mapFeatures";
import { loadMapPosition, type MapPosition, saveMapPosition } from "@/map/mapPosition";
import { notesTileUrl, routesTileUrl, stationsTileUrl, ZOOM_RANGES } from "@/map/tileUrls";
import { useBasemapStyle } from "@/map/useBasemapStyle";
import { useRegion } from "@/region/RegionContext";
import { useTheme } from "@/theme/ThemeContext";

/** The map's own zoom limits, as `useMapLibre` sets them on the web. */
const MIN_ZOOM = 4;
const MAX_ZOOM = 18;

/** How long a settled camera waits before its position is written down. */
const SAVE_DEBOUNCE_MS = 500;

interface RailwayMapProps {
  /** Whose visit colours the routes carry — the tile's `user_id` parameter. */
  userId: number;
  /** The country filter, already resolved for this region (`useEffectiveCountries`). */
  countries: string[];
}

/** `region.bounds` is `[[w, s], [e, n]]`; the binding wants `[w, s, e, n]`. */
function flatBounds(regionId: RegionId): [number, number, number, number] {
  const [[west, south], [east, north]] = REGIONS[regionId].bounds;
  return [west, south, east, north];
}

export function RailwayMap({ userId, countries }: RailwayMapProps): ReactNode {
  const { resolved: theme } = useTheme();
  const { regionId } = useRegion();
  const { showHeritage, showSpecial, showScenicOutline } = useLayerPrefs();

  const basemapStyle = useBasemapStyle(theme);
  const initialPosition = useInitialPosition(regionId);

  const cameraRef = useRef<CameraRef>(null);
  const [feature, setFeature] = useState<MapFeature | null>(null);

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
    setFeature(null);

    // Nothing picked out of the old region survives into the new one, and neither
    // does the camera: `initialViewState` cannot be revisited, so this is a stop.
    void loadMapPosition(regionId).then((saved) => {
      const region = REGIONS[regionId];
      const next = saved ?? { center: region.center, zoom: region.zoom };
      position.current = next;
      cameraRef.current?.setStop({ ...next, duration: 0 });
    });
  }, [regionId]);

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

  const routesUrl = useMemo(
    () => routesTileUrl({ userId, selectedCountries: countries }),
    [userId, countries],
  );

  // A press on a source stops there rather than bubbling to the map, whose own
  // handler is the dismissal — otherwise the press that opened the sheet would close
  // it in the same gesture.
  const takePress = useCallback(
    (
      event: NativeSyntheticEvent<PressEventWithFeatures>,
      read: (properties: Record<string, unknown> | null, id: unknown) => MapFeature | null,
    ) => {
      event.stopPropagation();
      const hit = event.nativeEvent.features[0];
      if (!hit) return;
      const next = read((hit.properties ?? null) as Record<string, unknown> | null, hit.id);
      if (next) setFeature(next);
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
    <View className="flex-1">
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
        attributionPosition={{ bottom: 8, right: 8 }}
        onPress={() => setFeature(null)}
        onRegionDidChange={handleRegionDidChange}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: position.current.center, zoom: position.current.zoom }}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          maxBounds={flatBounds(regionId)}
        />

        <VectorSource
          id="railway_routes"
          tiles={[routesUrl]}
          minzoom={ZOOM_RANGES.railwayRoutes.min}
          maxzoom={ZOOM_RANGES.railwayRoutes.max}
          onPress={(event) => takePress(event, toRouteFeature)}
        >
          {/* Amber outline under scenic routes, where the region offers it at all. */}
          {showScenicOutline && REGIONS[regionId].hasScenicHighlight ? (
            <Layer
              {...shown(createScenicRoutesOutlineLayer(userScenicLayerConfig))}
              filter={scenicOutlineFilter(showHeritage)}
            />
          ) : null}
          <Layer {...createRailwayRoutesLayer(userRouteLayerConfig)} />
          {showHeritage ? (
            <Layer {...shown(createRailwayRoutesHeritageLayer(userHeritageLayerConfig))} />
          ) : null}
          {showSpecial ? (
            <Layer {...shown(createRailwayRoutesSpecialLayer(userSpecialLayerConfig))} />
          ) : null}
        </VectorSource>

        <VectorSource
          id="stations"
          tiles={[stationsTileUrl()]}
          minzoom={ZOOM_RANGES.stations.min}
          maxzoom={ZOOM_RANGES.stations.max}
          onPress={(event) => takePress(event, (properties) => toStationFeature(properties))}
        >
          <Layer {...createStationsLayer(theme)} />
          <Layer {...createStationLabelsLayer(theme)} />
        </VectorSource>

        <VectorSource
          id="public_notes"
          tiles={[notesTileUrl()]}
          minzoom={ZOOM_RANGES.publicNotes.min}
          maxzoom={ZOOM_RANGES.publicNotes.max}
          onPress={(event) => takePress(event, (properties) => toNoteFeature(properties))}
        >
          <Layer {...createPublicNotesLayer()} />
        </VectorSource>
      </MapLibreMap>

      {feature ? (
        <FeatureSheet feature={feature} regionId={regionId} onClose={() => setFeature(null)} />
      ) : null}
    </View>
  );
}

/**
 * The three optional layers come out of the shared factories hidden, because that is
 * the state the web app's imperative toggles start them in. Here they are mounted
 * only when they are wanted, so the one thing to undo is that default.
 */
function shown(layer: LineLayerSpecification): LineLayerSpecification {
  return { ...layer, layout: { ...layer.layout, visibility: "visible" } };
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
