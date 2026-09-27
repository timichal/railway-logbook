import type * as maplibregl from "maplibre-gl";
import { useEffect } from "react";
import type { GeoJSONFeatureCollection, RailwayPart } from "@/lib/shared/types";
import { CIRCLES, COLORS, OPACITIES, WIDTHS } from "../index";

interface OverlayData {
  previewRoute?: {
    partIds: string[];
    coordinates: [number, number][];
    railwayParts?: RailwayPart[];
  } | null;
  selectedCoordinates?: {
    startingCoordinate: [number, number] | null;
    endingCoordinate: [number, number] | null;
  };
  routeEndpoints: GeoJSONFeatureCollection | null;
  isEditingGeometry?: boolean;
}

/**
 * The route endpoints overlay (`createRouteEndpointsLayer`) is part of the map's
 * construction (see AdminMap), built over this empty source, rather than added once
 * its data arrives: it then exists before the layer toggles are first applied and
 * keeps its visibility across refreshes, the hook below only ever swapping its data.
 * Added on arrival, it came back visible after every save while its box still read
 * unticked.
 */
export const routeEndpointsSource: maplibregl.GeoJSONSourceSpecification = {
  type: "geojson",
  data: { type: "FeatureCollection", features: [] },
};

/**
 * Remove a GeoJSON layer and its source from the map if they exist.
 */
function removeGeoJSONLayer(mapInstance: maplibregl.Map, id: string) {
  if (mapInstance.getLayer(id)) mapInstance.removeLayer(id);
  if (mapInstance.getSource(id)) mapInstance.removeSource(id);
}

/**
 * Manages GeoJSON overlay layers on the admin map:
 * - Preview route (line)
 * - Selected coordinate points (circles)
 * - Route endpoints (circles)
 */
export function useAdminMapOverlays(
  map: React.MutableRefObject<maplibregl.Map | null>,
  mapLoaded: boolean,
  data: OverlayData,
) {
  const { previewRoute, selectedCoordinates, routeEndpoints, isEditingGeometry } = data;

  // Preview route overlay
  // biome-ignore lint/correctness/useExhaustiveDependencies: isEditingGeometry is an intentional trigger to redraw the preview overlay when edit-geometry mode toggles.
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    removeGeoJSONLayer(map.current, "preview-route");

    if (previewRoute?.coordinates && previewRoute.coordinates.length > 0) {
      map.current.addSource("preview-route", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "LineString", coordinates: previewRoute.coordinates },
              properties: {},
            },
          ],
        },
      });

      map.current.addLayer({
        id: "preview-route",
        type: "line",
        source: "preview-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": COLORS.preview,
          "line-width": WIDTHS.preview,
          "line-opacity": OPACITIES.preview,
        },
      });
    }
  }, [previewRoute, mapLoaded, isEditingGeometry, map]);

  // Selected coordinate points overlay
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    removeGeoJSONLayer(map.current, "selected-points");

    const features: Array<{
      type: "Feature";
      geometry: { type: "Point"; coordinates: [number, number] };
      properties: { type: string };
    }> = [];

    if (selectedCoordinates?.startingCoordinate) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: selectedCoordinates.startingCoordinate },
        properties: { type: "start" },
      });
    }

    if (selectedCoordinates?.endingCoordinate) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: selectedCoordinates.endingCoordinate },
        properties: { type: "end" },
      });
    }

    if (features.length > 0) {
      map.current.addSource("selected-points", {
        type: "geojson",
        data: { type: "FeatureCollection", features },
      });

      map.current.addLayer({
        id: "selected-points",
        type: "circle",
        source: "selected-points",
        paint: {
          "circle-radius": CIRCLES.pickedPoint.radius,
          "circle-color": [
            "case",
            ["==", ["get", "type"], "start"],
            COLORS.adminMarkers.start,
            COLORS.adminMarkers.end,
          ],
          "circle-stroke-color": COLORS.adminMarkers.stroke,
          "circle-stroke-width": CIRCLES.pickedPoint.strokeWidth,
          "circle-opacity": 1.0,
        },
      });
    }
  }, [selectedCoordinates, mapLoaded, map]);

  // Route endpoints overlay: the layer is built with the map, only its data changes
  useEffect(() => {
    if (!map.current || !mapLoaded || !routeEndpoints) return;
    map.current
      .getSource<maplibregl.GeoJSONSource>("route-endpoints")
      ?.setData(routeEndpoints as GeoJSON.FeatureCollection);
  }, [routeEndpoints, mapLoaded, map]);
}
