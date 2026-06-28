"use client";

import type maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { getAllRouteEndpoints, getValidRoutesTotalKm } from "@/lib/adminRouteActions";
import {
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
  createScenicRoutesOutlineLayer,
  createStationsLayer,
  createStationsSource,
  lineClassColorExpression,
  OPACITIES,
} from "@/lib/map";
import { useAdminLayerVisibility } from "@/lib/map/hooks/useAdminLayerVisibility";
import { useAdminMapOverlays } from "@/lib/map/hooks/useAdminMapOverlays";
import { useAdminNotesPopup } from "@/lib/map/hooks/useAdminNotesPopup";
import { useMapLibre } from "@/lib/map/hooks/useMapLibre";
import { useRouteLength } from "@/lib/map/hooks/useRouteLength";
import { setupAdminMapInteractions } from "@/lib/map/interactions/adminMapInteractions";
import {
  getAdminRouteHeritageWidthExpression,
  getAdminRouteWidthExpression,
} from "@/lib/map/utils/userRouteStyling";
import type { GeoJSONFeatureCollection, RailwayPart } from "@/lib/types";
import AdminLayerControls from "./AdminLayerControls";

// The base layer draws Regular routes solid; Heritage (dotted) and Special
// (dashed) get their own layers so the dash/dot gaps aren't filled by a solid
// line underneath. All three are always shown on the admin map.
const REGULAR_ONLY_FILTER = ["==", ["get", "usage_type"], 0] as maplibregl.FilterSpecification;

// The three colored route line layers. They share identical visit/selection
// paint; only their dash style (baked into each factory) differs.
const ROUTE_LINE_LAYERS = [
  "railway_routes",
  "railway_routes_heritage",
  "railway_routes_special",
] as const;

/**
 * Apply the admin route paint (selected-route highlight + invalid-route grey) to
 * all three route line layers at once. `line-dasharray` is left untouched, so
 * the dotted/dashed styles baked into the heritage/special factories survive.
 */
function applyAdminRouteLinePaint(m: maplibregl.Map, selectedRouteId: string | null) {
  const trackIdNum =
    selectedRouteId && selectedRouteId !== "" ? parseInt(selectedRouteId, 10) : null;

  const colorExpression: maplibregl.ExpressionSpecification =
    trackIdNum !== null
      ? [
          "case",
          ["==", ["id"], trackIdNum],
          COLORS.railwayRoutes.selected,
          ["==", ["get", "is_valid"], false],
          COLORS.railwayRoutes.invalid,
          lineClassColorExpression(COLORS.railwayRoutes.default),
        ]
      : [
          "case",
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

interface VectorAdminMapProps {
  className?: string;
  onCoordinateClick?: (coordinate: [number, number]) => void;
  onRouteSelect?: (routeId: string) => void;
  selectedRouteId?: string | null;
  previewRoute?: {
    partIds: string[];
    coordinates: [number, number][];
    railwayParts?: RailwayPart[];
  } | null;
  selectedCoordinates?: {
    startingCoordinate: [number, number] | null;
    endingCoordinate: [number, number] | null;
  };
  refreshTrigger?: number;
  isEditingGeometry?: boolean;
  focusGeometry?: string | null;
  focusCoordinate?: { coordinate: [number, number]; nonce: number } | null;
  notesRefreshTrigger?: number;
  onNotesChanged?: () => void;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
}

export default function VectorAdminMap({
  className = "",
  onCoordinateClick,
  onRouteSelect,
  selectedRouteId,
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
}: VectorAdminMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [routesCacheBuster, setRoutesCacheBuster] = useState(Date.now());
  const [routeEndpoints, setRouteEndpoints] = useState<GeoJSONFeatureCollection | null>(null);
  const [validRoutesTotalKm, setValidRoutesTotalKm] = useState<number | null>(null);
  const isMobile = useIsMobile();

  const { previewLength, selectedRouteLength } = useRouteLength(previewRoute, selectedRouteId);

  // Store callbacks in refs to avoid map recreation on changes
  const onCoordinateClickRef = useRef(onCoordinateClick);
  const onRouteSelectRef = useRef(onRouteSelect);
  onCoordinateClickRef.current = onCoordinateClick;
  onRouteSelectRef.current = onRouteSelect;

  // Initialize map
  const { map, mapLoaded } = useMapLibre(
    mapContainer,
    {
      sources: {
        railway_parts: createRailwayPartsSource(),
        railway_routes: createRailwayRoutesSource({ cacheBuster: routesCacheBuster }),
        stations: createStationsSource(),
        admin_notes: createAdminNotesSource(),
      },
      layers: [
        createRailwayPartsLayer(),
        createScenicRoutesOutlineLayer(),
        createRailwayRoutesLayer({ filter: REGULAR_ONLY_FILTER }),
        createRailwayRoutesHeritageLayer(),
        createRailwayRoutesSpecialLayer(),
        createRailwayRoutesClickLayer(),
        createStationsLayer(),
        createAdminNotesLayer(),
      ],
      onLoad: (mapInstance) => {
        setupAdminMapInteractions(mapInstance, {
          onCoordinateClickRef,
          onRouteSelectRef,
        });
      },
    },
    [],
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
  useAdminNotesPopup({
    map,
    mapLoaded,
    showNotesLayer: layerVisibility.showNotesLayer,
    showSuccess,
    showError,
    externalRefreshSignal: notesRefreshTrigger,
    onNotesChanged,
  });

  // Fetch route endpoints
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTrigger is an intentional trigger to refetch endpoints on demand.
  useEffect(() => {
    if (!mapLoaded) return;
    getAllRouteEndpoints()
      .then(setRouteEndpoints)
      .catch((error) => console.error("Error fetching route endpoints:", error));
  }, [mapLoaded, refreshTrigger]);

  // Fetch total km of valid routes (refreshes when routes are saved/deleted)
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshTrigger is an intentional trigger to refetch the total on demand.
  useEffect(() => {
    getValidRoutesTotalKm()
      .then(setValidRoutesTotalKm)
      .catch((error) => console.error("Error fetching valid routes total km:", error));
  }, [refreshTrigger]);

  // Selected route highlighting
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    applyAdminRouteLinePaint(map.current, selectedRouteId ?? null);
  }, [selectedRouteId, mapLoaded, map]);

  // Refresh routes tiles when routes are saved/deleted
  useEffect(() => {
    if (!map.current || !mapLoaded || refreshTrigger === undefined || refreshTrigger === 0) return;

    const newCacheBuster = Date.now();
    setRoutesCacheBuster(newCacheBuster);

    // Remove layers → source → re-add
    const m = map.current;
    const routeLayers = [
      "railway_routes_click",
      "railway_routes_special",
      "railway_routes_heritage",
      "railway_routes",
      "railway_routes_scenic_outline",
    ];
    for (const id of routeLayers) {
      if (m.getLayer(id)) m.removeLayer(id);
    }
    if (m.getSource("railway_routes")) m.removeSource("railway_routes");

    m.addSource("railway_routes", createRailwayRoutesSource({ cacheBuster: newCacheBuster }));
    m.addLayer(createScenicRoutesOutlineLayer());
    m.addLayer(createRailwayRoutesLayer({ filter: REGULAR_ONLY_FILTER }));
    m.addLayer(createRailwayRoutesHeritageLayer());
    m.addLayer(createRailwayRoutesSpecialLayer());
    m.addLayer(createRailwayRoutesClickLayer());

    // Re-apply visibility (heritage/special factories default to hidden)
    const visibility = layerVisibility.showRoutesLayer ? "visible" : "none";
    for (const id of routeLayers) {
      m.setLayoutProperty(id, "visibility", visibility);
    }

    // Re-apply selected route highlighting / invalid coloring to all route layers
    applyAdminRouteLinePaint(m, selectedRouteId ?? null);

    m.triggerRepaint();
  }, [refreshTrigger, mapLoaded, layerVisibility.showRoutesLayer, selectedRouteId, map]);

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

      <AdminLayerControls {...layerVisibility} isMobile={isMobile} />

      {validRoutesTotalKm !== null && (
        <div
          className={`absolute bg-white p-3 rounded shadow-lg text-black z-10 ${
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
        <div className="absolute top-4 right-4 bg-white p-3 rounded shadow-lg text-black z-10">
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
