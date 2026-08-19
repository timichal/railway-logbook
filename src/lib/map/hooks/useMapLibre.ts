import * as maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEFAULT_REGION, REGIONS, type RegionId } from "@/lib/regions";
import {
  createBasemapFadeLayer,
  createOSMBackgroundLayer,
  createOSMBackgroundSource,
  loadBasemapStyle,
  resolveMissingBasemapIcons,
} from "../basemap";
import { loadMapState, saveMapState } from "../mapState";

// v6 ships ESM-only. Its worker does a relative import of maplibre-gl-shared.mjs
// at runtime; Next.js emits a `new URL(...)` worker as a bare asset without that
// sibling, so it 404s. Instead we serve both files from public/maplibre/ (copied
// by the copyMaplibreWorker script) where the relative import resolves.
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export interface UseMapLibreOptions {
  /**
   * Region the map is locked to: supplies the initial view, the panning bounds
   * and the key the saved position is stored under. Pass it in `deps` too, so
   * switching regions rebuilds the map.
   */
  region?: RegionId;
  center?: [number, number];
  zoom?: number;
  sources?: Record<string, maplibregl.SourceSpecification>;
  layers?: maplibregl.LayerSpecification[];
  onLoad?: (map: maplibregl.Map) => void;
}

export interface UseMapLibreReturn {
  map: React.MutableRefObject<maplibregl.Map | null>;
  mapLoaded: boolean;
}

/**
 * Base hook for initializing and managing a MapLibre GL JS map instance
 *
 * @param containerRef - Ref to the map container element
 * @param options - Configuration options for the map
 * @param deps - Optional dependencies array to control when map is recreated
 * @returns Object containing map ref and loaded state
 */
export function useMapLibre(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: UseMapLibreOptions = {},
  deps: React.DependencyList = [],
): UseMapLibreReturn {
  const {
    region = DEFAULT_REGION,
    center = REGIONS[region].center,
    zoom = REGIONS[region].zoom,
    sources = {},
    layers = [],
    onLoad,
  } = options;

  const map = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    if (!containerRef.current || map.current) return;

    // The basemap style is fetched before the map is created, rather than
    // swapped in once it arrives: MapLibre takes a single style object, and
    // setStyle later would discard every layer the other hooks add on top
    // (coverage overlay, highlights). loadBasemapStyle resolves null when the
    // vector style is unreachable, and we build the raster basemap instead.
    let cancelled = false;
    let teardown: (() => void) | undefined;

    const init = async () => {
      const basemap = await loadBasemapStyle();
      // The effect may have been torn down, or run twice, while we waited.
      if (cancelled || !containerRef.current || map.current) return;

      // Load saved map state or use defaults
      const savedState = loadMapState(region);
      const initialCenter = savedState?.center || center;
      const initialZoom = savedState?.zoom || zoom;

      // Build sources object (basemap + custom sources)
      const allSources: Record<string, maplibregl.SourceSpecification> = basemap
        ? { ...basemap.sources, ...sources }
        : { osm: createOSMBackgroundSource(), ...sources };

      // Basemap underneath, faded by the layer above it, our layers on top. The
      // raster fallback carries its own opacity and needs no fade layer.
      const backgroundLayers: maplibregl.LayerSpecification[] = basemap
        ? [...basemap.layers, createBasemapFadeLayer()]
        : [createOSMBackgroundLayer()];
      const allLayers: maplibregl.LayerSpecification[] = [...backgroundLayers, ...layers];

      // Create map instance
      map.current = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          // Both only exist for the vector basemap's own label and icon layers.
          glyphs: basemap?.glyphs,
          sprite: basemap?.sprite,
          sources: allSources,
          layers: allLayers,
        },
        center: initialCenter,
        zoom: initialZoom,
        minZoom: 4, // Limit minimum zoom
        maxZoom: 18, // Limit maximum zoom
        maxBounds: REGIONS[region].bounds, // Restrict panning to the current region
        pitchWithRotate: false, // Disable rotation on right-click drag
        dragRotate: false, // Disable rotation with Ctrl+drag
      });

      // The basemap asks for POI icons its own sprite does not carry.
      resolveMissingBasemapIcons(map.current);

      // Add navigation controls
      map.current.addControl(new maplibregl.NavigationControl(), "top-right");

      // Add geolocation control (show current location)
      map.current.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: {
            enableHighAccuracy: true,
          },
          trackUserLocation: true,
        }),
        "top-right",
      );

      // Add scale control
      map.current.addControl(
        new maplibregl.ScaleControl({
          maxWidth: 100,
          unit: "metric",
        }),
        "bottom-left",
      );

      // Save map state on move or zoom
      const saveState = () => {
        if (map.current) {
          const center = map.current.getCenter();
          const zoom = map.current.getZoom();
          saveMapState(
            {
              center: [center.lng, center.lat],
              zoom,
            },
            region,
          );
        }
      };

      // Listen for map movements
      map.current.on("moveend", saveState);
      map.current.on("zoomend", saveState);

      // Wait for style to load
      map.current.on("load", () => {
        setMapLoaded(true);
        if (onLoad && map.current) {
          onLoad(map.current);
        }
      });

      teardown = () => {
        if (map.current) {
          map.current.off("moveend", saveState);
          map.current.off("zoomend", saveState);
          map.current.remove();
          map.current = null;
          setMapLoaded(false);
        }
      };
    };

    init();

    // Cleanup on unmount
    return () => {
      cancelled = true;
      teardown?.();
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps is a caller-supplied dependency list (not a literal) used to control when the map is recreated; this is the hook's intended API.
  }, deps);

  return { map, mapLoaded };
}
