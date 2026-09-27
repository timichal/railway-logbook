"use client";

import type * as maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import AdminLayerControls from "@/components/admin/AdminLayerControls";
import MapStationSearch from "@/components/map/MapStationSearch";
import { useIsMobile } from "@/hooks/useIsMobile";
import { unwrap } from "@/lib/actionResult";
import { searchAllStations } from "@/lib/adminMapActions";
import { getAllRouteEndpoints, getValidRoutesTotalKm } from "@/lib/adminRouteActions";
import {
  adminNotesTileUrl,
  COLORS,
  createAdminNotesLayer,
  createAdminNotesSource,
  createRailwayPartsLayer,
  createRailwayPartsSource,
  createRailwayRoutesClickLayer,
  createRailwayRoutesHeritageLayer,
  createRailwayRoutesLayer,
  createRailwayRoutesSource,
  createRailwayRoutesSpecialLayer,
  createRouteEndpointsLayer,
  createScenicRoutesOutlineLayer,
  createStationLabelsLayer,
  createStationsLayer,
  createStationsSource,
  lineClassColorExpression,
  OPACITIES,
  railwayRoutesTileUrl,
} from "@/lib/map";
import { useAdminLayerVisibility } from "@/lib/map/hooks/useAdminLayerVisibility";
import { routeEndpointsSource, useAdminMapOverlays } from "@/lib/map/hooks/useAdminMapOverlays";
import { useAdminNotesPopup } from "@/lib/map/hooks/useAdminNotesPopup";
import { useMapLibre } from "@/lib/map/hooks/useMapLibre";
import { useRouteLength } from "@/lib/map/hooks/useRouteLength";
import type { PathPreview } from "@/lib/map/hooks/useRoutePreview";
import { useSourceTileRefresh } from "@/lib/map/hooks/useSourceTileRefresh";
import { setupAdminMapInteractions } from "@/lib/map/interactions/adminMapInteractions";
import { useRegionId } from "@/lib/regionContext";
import {
  getAdminRouteHeritageWidthExpression,
  getAdminRouteWidthExpression,
} from "@/lib/shared/map/utils/userRouteStyling";
import type { RegionId } from "@/lib/shared/regions";
import type { GeoJSONFeatureCollection, Station } from "@/lib/shared/types";
import { useResolvedTheme } from "@/lib/theme";

// The base layer draws Regular routes solid; Heritage (dotted) and Special
// (dashed) get their own layers so the dash/dot gaps aren't filled by a solid
// line underneath. All three are always shown on the admin map.
const REGULAR_ONLY_FILTER = ["==", ["get", "usage_type"], 0] as maplibregl.FilterSpecification;

// The admin map draws every station, so its search offers every station too — not
// only the near-route ones the user map's does. Module-level: the search hook
// re-creates its search whenever the function changes.
const searchAdminStations = (query: string, region: RegionId): Promise<Station[]> =>
  searchAllStations(query, region).then(unwrap);

// The three colored route line layers. They share identical visit/selection
// paint; only their dash style (baked into each factory) differs.
const ROUTE_LINE_LAYERS = [
  "railway_routes",
  "railway_routes_heritage",
  "railway_routes_special",
] as const;

/**
 * Apply the admin route paint (selected-route highlight + invalid-route grey,
 * violet for the ones flagged under repair) to all three route line layers at
 * once. `line-dasharray` is left untouched, so the dotted/dashed styles baked
 * into the heritage/special factories survive.
 */
function applyAdminRouteLinePaint(m: maplibregl.Map, selectedRouteId: number | null) {
  const trackIdNum = selectedRouteId ?? null;

  // `under_repair` is only ever set on invalid routes, but it is checked first
  // anyway so a stale flag can never outrank the grey.
  const colorExpression: maplibregl.ExpressionSpecification =
    trackIdNum !== null
      ? [
          "case",
          ["==", ["id"], trackIdNum],
          COLORS.railwayRoutes.selected,
          ["all", ["==", ["get", "is_valid"], false], ["==", ["get", "under_repair"], true]],
          COLORS.railwayRoutes.underRepair,
          ["==", ["get", "is_valid"], false],
          COLORS.railwayRoutes.invalid,
          lineClassColorExpression(COLORS.railwayRoutes.default),
        ]
      : [
          "case",
          ["all", ["==", ["get", "is_valid"], false], ["==", ["get", "under_repair"], true]],
          COLORS.railwayRoutes.underRepair,
          ["==", ["get", "is_valid"], false],
          COLORS.railwayRoutes.invalid,
          lineClassColorExpression(COLORS.railwayRoutes.default),
        ];

  const widthExpression = getAdminRouteWidthExpression(trackIdNum);
  // Heritage dots' diameter equals the line width, so they use their own width.
  const heritageWidthExpression = getAdminRouteHeritageWidthExpression(trackIdNum);

  const opacityExpression: maplibregl.ExpressionSpecification | number =
    trackIdNum !== null
      ? ["case", ["==", ["id"], trackIdNum], OPACITIES.selectedRoute, OPACITIES.defaultRoute]
      : OPACITIES.defaultRoute;

  for (const layerId of ROUTE_LINE_LAYERS) {
    if (!m.getLayer(layerId)) continue;
    m.setPaintProperty(layerId, "line-color", colorExpression);
    m.setPaintProperty(
      layerId,
      "line-width",
      layerId === "railway_routes_heritage" ? heritageWidthExpression : widthExpression,
    );
    m.setPaintProperty(layerId, "line-opacity", opacityExpression);
  }
}

interface AdminMapProps {
  className?: string;
  onCoordinateClick?: (coordinate: [number, number]) => void;
  onRouteSelect?: (routeId: number | null) => void;
  selectedRouteId?: number | null;
  /** The selected route's length, from the detail the page loads for the sidebar. */
  selectedRouteLength: number | null;
  previewRoute?: PathPreview | null;
  selectedCoordinates?: {
    startingCoordinate: [number, number] | null;
    endingCoordinate: [number, number] | null;
  };
  refreshTrigger?: number;
  isEditingGeometry?: boolean;
  focusGeometry?: string | null;
  focusCoordinate?: { coordinate: [number, number]; nonce: number } | null;
  notesRefreshTrigger: number;
  onNotesChanged: () => void;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
}

export default function AdminMap({
  className = "",
  onCoordinateClick,
  onRouteSelect,
  selectedRouteId,
  selectedRouteLength,
  previewRoute,
  selectedCoordinates,
  refreshTrigger,
  isEditingGeometry,
  focusGeometry,
  focusCoordinate,
  notesRefreshTrigger,
  onNotesChanged,
  showSuccess,
  showError,
}: AdminMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  // The route and note tiles' `v`. Refs, read when the map is built: a refresh
  // points the live source at a new one itself, and a later rebuild (region,
  // scheme) must start from the newest rather than from tiles the browser cached
  // before a save.
  const routesCacheBusterRef = useRef(Date.now());
  const notesCacheBusterRef = useRef(Date.now());
  const [routeEndpoints, setRouteEndpoints] = useState<GeoJSONFeatureCollection | null>(null);
  const [validRoutesTotalKm, setValidRoutesTotalKm] = useState<number | null>(null);
  const isMobile = useIsMobile();
  const regionId = useRegionId();

  const previewLength = useRouteLength(previewRoute);

  // Store callbacks in refs to avoid map recreation on changes
  const onCoordinateClickRef = useRef(onCoordinateClick);
  const onRouteSelectRef = useRef(onRouteSelect);
  onCoordinateClickRef.current = onCoordinateClick;
  onRouteSelectRef.current = onRouteSelect;

  // Initialize map
  // The station dots and their labels are picked against the basemap under them, so
  // they follow the scheme. useMapLibre rebuilds the map when it changes.
  const theme = useResolvedTheme();

  const { map, mapLoaded } = useMapLibre(
    mapContainer,
    {
      region: regionId,
      sources: () => ({
        railway_parts: createRailwayPartsSource(),
        railway_routes: createRailwayRoutesSource({ cacheBuster: routesCacheBusterRef.current }),
        stations: createStationsSource(),
        admin_notes: createAdminNotesSource(notesCacheBusterRef.current),
        "route-endpoints": routeEndpointsSource,
      }),
      layers: () => [
        createRailwayPartsLayer(),
        createScenicRoutesOutlineLayer(),
        createRailwayRoutesLayer({ filter: REGULAR_ONLY_FILTER }),
        createRailwayRoutesHeritageLayer(),
        createRailwayRoutesSpecialLayer(),
        createRailwayRoutesClickLayer(),
        createStationsLayer(theme),
        createStationLabelsLayer(theme),
        createAdminNotesLayer(),
        createRouteEndpointsLayer(),
      ],
      onLoad: (mapInstance) => {
        setupAdminMapInteractions(mapInstance, {
          onCoordinateClickRef,
          onRouteSelectRef,
          region: regionId,
        });
      },
    },
    [regionId],
  );

  // Layer visibility management
  const layerVisibility = useAdminLayerVisibility({ map, mapLoaded, isEditingGeometry });

  // GeoJSON overlay layers (preview route, selected points, route endpoints)
  useAdminMapOverlays(map, mapLoaded, {
    previewRoute,
    selectedCoordinates,
    routeEndpoints,
    isEditingGeometry,
  });

  // Notes popup system
  useAdminNotesPopup({ map, mapLoaded, showSuccess, showError, onNotesChanged });

  // Fetch route endpoints
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTrigger is an intentional trigger to refetch endpoints on demand.
  useEffect(() => {
    if (!mapLoaded) return;
    getAllRouteEndpoints(regionId)
      .then(unwrap)
      .then(setRouteEndpoints)
      .catch((error) => console.error("Error fetching route endpoints:", error));
  }, [mapLoaded, refreshTrigger, regionId]);

  // Fetch total km of valid routes (refreshes when routes are saved/deleted)
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTrigger is an intentional trigger to refetch the total on demand.
  useEffect(() => {
    getValidRoutesTotalKm(regionId)
      .then(unwrap)
      .then(setValidRoutesTotalKm)
      .catch((error) => console.error("Error fetching valid routes total km:", error));
  }, [refreshTrigger, regionId]);

  // Selected route highlighting
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    applyAdminRouteLinePaint(map.current, selectedRouteId ?? null);
  }, [selectedRouteId, mapLoaded, map]);

  // Refresh the route tiles when routes are saved/deleted, and the note tiles when
  // a note is, from the popup or the Notes tab.
  useSourceTileRefresh({
    map,
    mapLoaded,
    sourceId: "railway_routes",
    signal: refreshTrigger ?? 0,
    cacheBusterRef: routesCacheBusterRef,
    tileUrl: (cacheBuster) => railwayRoutesTileUrl({ cacheBuster }),
  });
  useSourceTileRefresh({
    map,
    mapLoaded,
    sourceId: "admin_notes",
    signal: notesRefreshTrigger,
    cacheBusterRef: notesCacheBusterRef,
    tileUrl: adminNotesTileUrl,
  });

  // Focus on a single coordinate (e.g. admin note clicked in Notes tab)
  useEffect(() => {
    if (!map.current || !mapLoaded || !focusCoordinate) return;
    const m = map.current;
    const targetZoom = Math.max(m.getZoom(), 13);
    m.flyTo({ center: focusCoordinate.coordinate, zoom: targetZoom, duration: 800 });
  }, [focusCoordinate, mapLoaded, map]);

  // Focus on route geometry
  useEffect(() => {
    if (!map.current || !mapLoaded || !focusGeometry || isEditingGeometry) return;

    try {
      const geojson = JSON.parse(focusGeometry);
      if (geojson?.type === "LineString" && geojson.coordinates) {
        const coordinates = geojson.coordinates as [number, number][];
        const lngs = coordinates.map((coord) => coord[0]);
        const lats = coordinates.map((coord) => coord[1]);
        const bounds: [[number, number], [number, number]] = [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ];
        map.current.fitBounds(bounds, { padding: 80, duration: 1000, maxZoom: 13 });
      }
    } catch (error) {
      console.error("Error parsing geometry for focus:", error);
    }
  }, [focusGeometry, mapLoaded, isEditingGeometry, map]);

  return (
    <div className={`${className} relative`}>
      <div ref={mapContainer} className="w-full h-full" />

      <MapStationSearch
        map={map}
        region={regionId}
        isMobile={isMobile}
        search={searchAdminStations}
        // On a phone the collapsed "Layers" pill holds the top-left corner, and the
        // expanded panel, later in the tree, covers the box while it is open.
        positionClassName={isMobile ? "top-3 left-20 right-14" : undefined}
      />

      <AdminLayerControls {...layerVisibility} isMobile={isMobile} />

      {validRoutesTotalKm !== null && (
        <div
          className={`absolute bg-surface p-3 rounded shadow-lg text-fg z-10 ${
            isMobile ? "bottom-10 left-3 text-xs" : "bottom-10 right-4"
          }`}
        >
          <h3 className={`font-bold mb-1 ${isMobile ? "text-xs" : "text-sm"}`}>Valid routes</h3>
          <div className={`font-semibold ${isMobile ? "text-sm" : "text-lg"}`}>
            {validRoutesTotalKm.toFixed(1)} km
          </div>
        </div>
      )}

      {(previewLength !== null || selectedRouteLength !== null) && (
        // Below the station search, clear of MapLibre's top-right controls.
        <div
          className={`absolute bg-surface p-3 rounded shadow-lg text-fg z-10 ${
            isMobile ? "top-14 right-14" : "top-16 right-12"
          }`}
        >
          <h3 className="font-bold mb-2">Route Length</h3>
          {previewLength !== null && (
            <div className="text-sm">
              Preview: <span className="font-semibold">{previewLength.toFixed(1)} km</span>
            </div>
          )}
          {selectedRouteLength !== null && previewLength === null && (
            <div className="text-sm">
              Selected: <span className="font-semibold">{selectedRouteLength.toFixed(1)} km</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
