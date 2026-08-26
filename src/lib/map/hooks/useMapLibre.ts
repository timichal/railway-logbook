import * as maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEFAULT_REGION, REGIONS, type RegionId } from "@/lib/regions";
import {
  createBasemapFadeLayer,
  createOSMBackgroundLayer,
  createOSMBackgroundSource,
  GLYPHS_URL,
  loadBasemapStyle,
  resolveMissingBasemapIcons,
} from "../basemap";
import { loadMapState, saveMapState } from "../mapState";

// v6 ships ESM-only. Its worker does a relative import of maplibre-gl-shared.mjs
// at runtime; Next.js emits a `new URL(...)` worker as a bare asset without that
// sibling, so it 404s. Instead we serve both files from public/maplibre/ (copied
// by the copyMaplibreWorker script) where the relative import resolves.
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

/**
 * Release the GeolocateControl's location lock when the user zooms.
 *
 * MapLibre drops the lock as soon as the map is panned, but deliberately keeps
 * it through a zoom (its `movestart` handler bails while `map.isZooming()`).
 * With `trackUserLocation` the lock re-centers the map on every position fix —
 * a `fitBounds` over the accuracy circle, which sets the zoom too — so a zoom
 * is undone by the next fix a second later. Zooming means "I want to look at
 * this differently" just as panning does, so it releases the lock here as well:
 * the location dot stays, the map stops being dragged back to it.
 *
 * The release runs the control's *own* `movestart` handler with `isZooming()`
 * forced false for the call, rather than reimplementing the transition — going
 * to BACKGROUND is a private state machine plus button classes plus two fired
 * events, and a hand-written copy would drift out of step. If a later version
 * renames those internals, the guarded lookups simply do nothing and we are
 * back to the current upstream behaviour instead of a half-applied state.
 *
 * Returns the listener so the caller can detach it.
 */
function watchGeolocateZoom(map: maplibregl.Map, geolocate: maplibregl.GeolocateControl) {
  const handler = (event: maplibregl.MapMovementEvent) => {
    // The control's own re-centering passes `geolocateSource` through fitBounds,
    // and event data is copied onto the event object.
    if ((event as { geolocateSource?: boolean }).geolocateSource) return;
    const internals = geolocate as unknown as {
      _watchState?: string;
      _onMoveStart?: (event: unknown) => void;
    };
    if (internals._watchState !== "ACTIVE_LOCK" || typeof internals._onMoveStart !== "function") {
      return;
    }
    const isZooming = map.isZooming;
    map.isZooming = () => false;
    try {
      internals._onMoveStart({});
    } finally {
      map.isZooming = isZooming;
    }
  };
  map.on("zoomstart", handler);
  return handler;
}

/**
 * The attribution, in its usual bottom-right corner but **not unrolled on arrival**.
 *
 * MapLibre's compact mode (below 640px of map, its own threshold for "a line of
 * attribution no longer fits") adds the ⓘ button and then opens it: `_updateCompact`
 * sets `maplibregl-compact-show`, and the only thing that ever minimizes it again is
 * a drag. So a phone loaded with the notice unrolled along the bottom edge and its
 * far half clipped by the map. It should start behind the ⓘ, which is what OSMF's
 * attribution guidelines allow where the display is too small to carry the notice —
 * so long as it is one tap behind a visible icon, which `compact` guarantees.
 * `globals.css` then caps the expanded width so it wraps upward off the bottom edge
 * instead of running off the side.
 *
 * **It is `_updateCompact` that has to be tamed, not the state it leaves behind.**
 * A one-off minimize after `addControl` does not hold: the attribution text arrives
 * with the sources' TileJSON, and `_updateAttributions` re-runs `_updateCompact`
 * when it changes, which re-opens the panel. Nor can we minimize on `sourcedata` —
 * that fires per tile and would snap shut a panel the reader had opened. So the
 * control's own recompute is wrapped, and only its opening is undone; every other
 * path to the class, the reader's tap included, is untouched. `compact-show` is
 * *removed* rather than never added because upstream's collapsed state is exactly
 * that — `open` set, `compact-show` absent, the two inverted so the `details`
 * element's native toggle still lands the right way up.
 *
 * Guarded like `watchGeolocateZoom`: if the internal is renamed, the attribution is
 * merely left open, which is what it does today.
 */
function addAttribution(map: maplibregl.Map): void {
  const control = new maplibregl.AttributionControl({
    // Passing options at all replaces MapLibre's defaults wholesale, and the
    // library's own credit is one of them. Restated rather than silently dropped.
    customAttribution: '<a href="https://maplibre.org/" target="_blank">MapLibre</a>',
  });
  const internals = control as unknown as {
    _updateCompact?: () => void;
    _container?: HTMLElement;
  };
  const recompute = internals._updateCompact;
  if (typeof recompute === "function") {
    internals._updateCompact = () => {
      recompute.call(control);
      internals._container?.classList.remove("maplibregl-compact-show");
    };
  }
  map.addControl(control, "bottom-right");
}

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
          // Our station labels need glyphs whichever basemap we ended up with,
          // so the fallback declares the endpoint the vector style would have.
          glyphs: basemap?.glyphs ?? GLYPHS_URL,
          // Only the vector basemap's own icon layers use the sprite.
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
        // Added by hand below, so it can pick its corner — see addAttribution.
        attributionControl: false,
      });

      // The basemap asks for POI icons its own sprite does not carry.
      resolveMissingBasemapIcons(map.current);

      // Add navigation controls
      map.current.addControl(new maplibregl.NavigationControl(), "top-right");

      // Add geolocation control (show current location)
      const geolocate = new maplibregl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true,
        },
        trackUserLocation: true,
      });
      map.current.addControl(geolocate, "top-right");
      const releaseLockOnZoom = watchGeolocateZoom(map.current, geolocate);

      // Add scale control
      map.current.addControl(
        new maplibregl.ScaleControl({
          maxWidth: 100,
          unit: "metric",
        }),
        "bottom-left",
      );

      addAttribution(map.current);

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
          map.current.off("zoomstart", releaseLockOnZoom);
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
