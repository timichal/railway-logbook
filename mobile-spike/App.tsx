import { Camera, Layer, Map, VectorSource } from "@maplibre/maplibre-react-native";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { type BasemapStyle, loadBasemapStyle } from "./src/basemapStyle";
import {
  BASEMAP_FONT_BOLD,
  CIRCLES,
  COLORS,
  DASHES,
  getUserRouteColorExpression,
  getUserRouteHeritageWidthExpression,
  getUserRouteScenicOutlineWidthExpression,
  getUserRouteWidthExpression,
  LABELS,
  OPACITIES,
  REGULAR_ONLY_FILTER,
  stationLabelSizeExpression,
} from "./src/railwayStyle";
import { REGIONS, type RegionId } from "./src/regions";
import { publicStationsTileUrl, railwayRoutesTileUrl, ZOOM_RANGES } from "./src/tiles";
import { useFrameRate } from "./src/useFrameRate";

/**
 * Phase 0 spike — see README.md for what this answers and what to report back.
 *
 * Every expression and colour comes from `src/railwayStyle.ts`, which is a port
 * of the web app's own single source of truth. Nothing here is styled by hand,
 * so if the map looks right, the port is proven.
 */

/** The owner/admin user id, whose rides colour the routes. */
const OWNER_USER_ID = 1;

/**
 * A ladder for isolating a native crash, kept because it earned its keep: the
 * launch crash traced through it to the colour expression (see
 * `railwayStyle.ts`), and the top two rungs are still unmeasured. Each level
 * adds one piece of the map subtree, and a bump is JS only — relaunch, no native
 * rebuild. 12 is the whole thing.
 *
 * Confirmed working on a physical iPhone up to and including 8:
 *
 *   0 — no <Map> at all (the app shell alone)
 *   1 — bare <Map> with MINIMAL_STYLE, no handlers, no children
 *   2 — + the fetched & transformed basemap style
 *   3 — + <Camera> (initialViewState / maxBounds / zoom limits)
 *   4 — + the event handlers. onDidFinishRenderingFrame is fine on iOS under
 *         the New Architecture, despite maplibre-react-native#1165
 *   5 — + the stations source, circles and labels — glyphs resolve, bold Noto
 *   6 — route source + main layer, CONSTANT colour and width, no filter. The
 *         789 KB z4 tile fetches, parses and draws: question 2's premise holds
 *   7 — + the REGULAR_ONLY_FILTER expression
 *   8 — + the real line-color expression. This is what crashed, until it was
 *         restructured; see getUserRouteColorExpression in railwayStyle.ts
 *
 * Still to check on the device:
 *
 *   9 — + the real line-width expression: a zoom `interpolate` whose stop values
 *         are `case` expressions. The other composite, and untested — if it
 *         crashes, expect the same std::bad_alloc and the same kind of fix
 *  10 — + the scenic outline layer (its filter nests REGULAR_ONLY_FILTER in an
 *         `["all", ...]`, which is the construct that broke line-color)
 *  11 — + the heritage layer. Does dasharray [0, 3] — a zero-length dash — give
 *         round dots on native as it does in GL JS?
 *  12 — + the special layer (dasharray [2.5, 2]). The full stack.
 */
const BISECT_LEVEL: number = 12;

/**
 * Level 1's stand-in for the real basemap: the smallest style the spec allows,
 * so a crash at level 1 is the native map itself rather than anything about our
 * fetched-and-transformed style. `mapStyle` is required, hence a style rather
 * than `undefined`.
 */
const MINIMAL_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: "bg", type: "background" as const, paint: { "background-color": "#e5e7eb" } }],
};

export default function App() {
  const [regionId, setRegionId] = useState<RegionId>("europe");
  const [showRoutes, setShowRoutes] = useState(true);
  const [showHeritage, setShowHeritage] = useState(false);
  const [showSpecial, setShowSpecial] = useState(false);
  const [showScenic, setShowScenic] = useState(false);
  const [showStations, setShowStations] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [colourByUser, setColourByUser] = useState(true);
  const [meterOn, setMeterOn] = useState(true);

  const [basemap, setBasemap] = useState<BasemapStyle | null>(null);
  const [styleMs, setStyleMs] = useState<number | null>(null);
  const [layerCount, setLayerCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [fullyRendered, setFullyRendered] = useState(false);

  const { fps, minFps, onFrame, reset } = useFrameRate(meterOn);
  const region = REGIONS[regionId];

  if (BISECT_LEVEL === 0) {
    return (
      <View style={styles.centered}>
        <StatusBar style="dark" />
        <Text style={styles.errorTitle}>Shell launched, no map</Text>
        <Text style={styles.errorBody}>
          Level 0 renders no map at all. If this shows, the app shell is fine and anything wrong is
          in the map subtree. Bump BISECT_LEVEL.
        </Text>
      </View>
    );
  }

  // Fetched once and reused across region switches: the style carries no region
  // of its own, and refetching would only re-measure the same thing.
  useEffect(() => {
    let cancelled = false;
    loadBasemapStyle(true)
      .then((result) => {
        if (cancelled) return;
        setBasemap(result.style);
        setStyleMs(result.elapsedMs);
        setLayerCount(result.layerCount);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const routeTiles = useMemo(
    () => [railwayRoutesTileUrl(colourByUser ? OWNER_USER_ID : undefined)],
    [colourByUser],
  );

  if (error) {
    return (
      <View style={styles.centered}>
        <StatusBar style="dark" />
        <Text style={styles.errorTitle}>Basemap style failed</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Text style={styles.errorBody}>
          The web app falls back to raster OSM tiles at this point. The spike deliberately does not
          — a failure here is itself a finding worth reporting.
        </Text>
      </View>
    );
  }

  if (!basemap && BISECT_LEVEL >= 2) {
    return (
      <View style={styles.centered}>
        <StatusBar style="dark" />
        <ActivityIndicator />
        <Text style={styles.errorBody}>Fetching and processing the basemap style...</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <Map
        style={styles.map}
        mapStyle={BISECT_LEVEL >= 2 && basemap ? basemap : MINIMAL_STYLE}
        onDidFinishRenderingFrame={BISECT_LEVEL >= 4 && meterOn ? onFrame : undefined}
        onDidFinishRenderingMapFully={
          BISECT_LEVEL >= 4 ? () => setFullyRendered(true) : undefined
        }
        onDidFailLoadingMap={
          BISECT_LEVEL >= 4 ? () => setMapError("onDidFailLoadingMap fired") : undefined
        }
        onRegionDidChange={
          BISECT_LEVEL >= 4 ? (event) => setZoom(event.nativeEvent.zoom) : undefined
        }
      >
        {/*
          Remounted per region so the camera re-applies its view state and
          bounds — the same thing the web app achieves by rebuilding the map.
          Note LngLatBounds is FLAT [w, s, e, n] in this binding, unlike the web
          app's nested [[w, s], [e, n]].
        */}
        {BISECT_LEVEL >= 3 ? (
          <Camera
            key={regionId}
            initialViewState={{ center: region.center, zoom: region.zoom }}
            maxBounds={[
              region.bounds[0][0],
              region.bounds[0][1],
              region.bounds[1][0],
              region.bounds[1][1],
            ]}
            minZoom={ZOOM_RANGES.railwayRoutes.min}
            maxZoom={ZOOM_RANGES.railwayRoutes.max}
          />
        ) : null}

        {BISECT_LEVEL >= 6 && showRoutes ? (
          // Keyed on the tile URL so flipping "my rides" genuinely re-creates the
          // source rather than leaving the previous tiles in place.
          <VectorSource
            key={routeTiles[0]}
            id="railway_routes"
            tiles={routeTiles}
            minzoom={ZOOM_RANGES.railwayRoutes.min}
            maxzoom={ZOOM_RANGES.railwayRoutes.max}
          >
            {/* Bottom to top, matching createUserMapLayers(). */}
            {BISECT_LEVEL >= 10 ? (
              <Layer
                id="railway_routes_scenic_outline"
                type="line"
                source-layer="railway_routes"
                layout={{ visibility: showScenic ? "visible" : "none" }}
                filter={["all", ["==", ["get", "scenic"], true], REGULAR_ONLY_FILTER]}
                paint={{
                  "line-color": COLORS.scenicOutline,
                  "line-width": getUserRouteScenicOutlineWidthExpression(),
                  "line-opacity": OPACITIES.scenicOutline,
                }}
              />
            ) : null}
            <Layer
              id="railway_routes"
              type="line"
              source-layer="railway_routes"
              filter={BISECT_LEVEL >= 7 ? REGULAR_ONLY_FILTER : undefined}
              paint={{
                "line-color": BISECT_LEVEL >= 8 ? getUserRouteColorExpression() : "#b8554f",
                "line-width": BISECT_LEVEL >= 9 ? getUserRouteWidthExpression() : 1.5,
                "line-opacity": OPACITIES.defaultRoute,
              }}
            />
            {BISECT_LEVEL >= 11 ? (
              <Layer
                id="railway_routes_heritage"
                type="line"
                source-layer="railway_routes"
                layout={{
                  visibility: showHeritage ? "visible" : "none",
                  // Without the round cap the zero-length dashes render as nothing.
                  "line-cap": "round",
                }}
                filter={["==", ["get", "usage_type"], 1]}
                paint={{
                  "line-color": getUserRouteColorExpression(),
                  "line-width": getUserRouteHeritageWidthExpression(),
                  "line-opacity": OPACITIES.defaultRoute,
                  "line-dasharray": [...DASHES.heritage],
                }}
              />
            ) : null}
            {BISECT_LEVEL >= 12 ? (
              <Layer
                id="railway_routes_special"
                type="line"
                source-layer="railway_routes"
                layout={{ visibility: showSpecial ? "visible" : "none" }}
                filter={["==", ["get", "usage_type"], 2]}
                paint={{
                  "line-color": getUserRouteColorExpression(),
                  "line-width": getUserRouteWidthExpression(),
                  "line-opacity": OPACITIES.defaultRoute,
                  "line-dasharray": [...DASHES.special],
                }}
              />
            ) : null}
          </VectorSource>
        ) : null}

        {BISECT_LEVEL >= 5 && showStations ? (
          <VectorSource
            id="stations"
            tiles={[publicStationsTileUrl()]}
            minzoom={ZOOM_RANGES.stations.min}
            maxzoom={ZOOM_RANGES.stations.max}
          >
            <Layer
              id="stations"
              type="circle"
              source-layer="stations"
              minzoom={ZOOM_RANGES.stations.min}
              paint={{
                "circle-radius": CIRCLES.station.radius,
                "circle-color": COLORS.stations.fill,
                "circle-stroke-color": COLORS.stations.stroke,
                "circle-stroke-width": CIRCLES.station.strokeWidth,
                "circle-opacity": OPACITIES.stations,
              }}
            />
            {/*
              The labels are the glyph test. `text-font` names exactly one font,
              and the glyphs come from the style's own `glyphs` endpoint — if the
              names render in something that is not bold Noto, the native SDK is
              substituting a system font, which is what the web app did before
              the single-font fix.
            */}
            <Layer
              id="station_labels"
              type="symbol"
              source-layer="stations"
              minzoom={LABELS.station.minZoom}
              layout={{
                visibility: showLabels ? "visible" : "none",
                "text-field": ["get", "name"],
                "text-font": [BASEMAP_FONT_BOLD],
                "text-size": stationLabelSizeExpression(),
                "text-anchor": "top",
                "text-offset": [0, LABELS.station.offsetEm],
                "text-max-width": LABELS.station.maxWidthEm,
                "text-line-height": LABELS.station.lineHeight,
                "text-allow-overlap": false,
                "text-padding": 2,
              }}
              paint={{
                "text-color": COLORS.stations.label,
                "text-halo-color": COLORS.stations.labelHalo,
                "text-halo-width": LABELS.station.haloWidth,
              }}
            />
          </VectorSource>
        ) : null}
      </Map>

      <View style={styles.hud} pointerEvents="box-none">
        <View style={styles.readout}>
          <Text style={styles.readoutText}>
            {meterOn ? `${fps ?? "-"} fps` : "meter off"}
            {meterOn && minFps !== null ? `  (low ${minFps})` : ""}
          </Text>
          <Text style={styles.readoutSub}>
            {`z${zoom === null ? "-" : zoom.toFixed(1)} · style ${styleMs ?? "-"}ms · ${layerCount ?? "-"} layers${fullyRendered ? " · rendered" : ""}`}
          </Text>
          {mapError ? <Text style={styles.readoutError}>{mapError}</Text> : null}
        </View>
      </View>

      <ScrollView
        horizontal
        style={styles.chipBar}
        contentContainerStyle={styles.chipBarContent}
        showsHorizontalScrollIndicator={false}
      >
        <Chip label="reset meter" active={false} onPress={reset} />
        <Chip
          label={regionId === "europe" ? "→ Japan" : "→ Europe"}
          active
          onPress={() => setRegionId(regionId === "europe" ? "japan" : "europe")}
        />
        <Chip label="routes" active={showRoutes} onPress={() => setShowRoutes((v) => !v)} />
        <Chip label="my rides" active={colourByUser} onPress={() => setColourByUser((v) => !v)} />
        <Chip label="heritage" active={showHeritage} onPress={() => setShowHeritage((v) => !v)} />
        <Chip label="special" active={showSpecial} onPress={() => setShowSpecial((v) => !v)} />
        <Chip label="scenic" active={showScenic} onPress={() => setShowScenic((v) => !v)} />
        <Chip label="stations" active={showStations} onPress={() => setShowStations((v) => !v)} />
        <Chip label="labels" active={showLabels} onPress={() => setShowLabels((v) => !v)} />
        <Chip label="meter" active={meterOn} onPress={() => setMeterOn((v) => !v)} />
      </ScrollView>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && styles.chipPressed,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  map: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  errorTitle: { fontSize: 18, fontWeight: "700" },
  errorBody: { fontSize: 14, color: "#444", textAlign: "center" },
  hud: { position: "absolute", top: 56, left: 12, right: 12 },
  readout: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  readoutText: { fontSize: 20, fontWeight: "700", fontVariant: ["tabular-nums"] },
  readoutSub: { fontSize: 12, color: "#444", fontVariant: ["tabular-nums"] },
  readoutError: { fontSize: 12, color: "#b91c1c", fontWeight: "600" },
  chipBar: { position: "absolute", bottom: 0, left: 0, right: 0, maxHeight: 96 },
  chipBarContent: { paddingHorizontal: 12, paddingVertical: 16, gap: 8, alignItems: "center" },
  chip: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  chipActive: { backgroundColor: "#1f8a4c", borderColor: "#166534" },
  chipPressed: { opacity: 0.7 },
  chipText: { fontSize: 14, fontWeight: "600", color: "#374151" },
  chipTextActive: { color: "#fff" },
});
