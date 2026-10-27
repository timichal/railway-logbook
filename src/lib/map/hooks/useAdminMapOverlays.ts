import type * as maplibregl from "maplibre-gl";
import { useEffect } from "react";
import { SCENIC_ENDPOINTS_LAYER_ID } from "@/lib/shared/map/layers";
import type { GeoJSONFeatureCollection } from "@/lib/shared/types";
import { CIRCLES, COLORS, OPACITIES, WIDTHS } from "../index";
import type { PathPreview } from "./useRoutePreview";

interface OverlayData {
  previewRoute?: PathPreview | null;
  selectedCoordinates?: {
    startingCoordinate: [number, number] | null;
    endingCoordinate: [number, number] | null;
  };
  routeEndpoints: GeoJSONFeatureCollection | null;
  scenicEndpoints: GeoJSONFeatureCollection;
  isEditingGeometry?: boolean;
}

/**
 * The endpoint overlays (`createRouteEndpointsLayer`, `createScenicEndpointsLayer`)
 * are part of the map's construction (see AdminMap), each built over an empty source
 * from here, rather than added once their data arrives: they then exist before the
 * layer toggles are first applied and keep their visibility across refreshes, the
 * hook below only ever swapping their data. Added on arrival, they came back visible
 * after every save while their box still read unticked.
 */
export const emptyEndpointsSource = (): maplibregl.GeoJSONSourceSpecification => ({
  type: "geojson",
  data: { type: "FeatureCollection", features: [] },
});

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
 * - Route endpoints and scenic line endpoints (circles)
 */
export function useAdminMapOverlays(
  map: React.RefObject<maplibregl.Map | null>,
  mapLoaded: boolean,
  data: OverlayData,
) {
  const { previewRoute, selectedCoordinates, routeEndpoints, scenicEndpoints, isEditingGeometry } =
    data;

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

  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    map.current
      .getSource<maplibregl.GeoJSONSource>(SCENIC_ENDPOINTS_LAYER_ID)
      ?.setData(scenicEndpoints as GeoJSON.FeatureCollection);
  }, [scenicEndpoints, mapLoaded, map]);
}
