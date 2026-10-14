import type * as maplibreglType from "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import type { MutableRefObject } from "react";
import { featuresAt, ROUTE_HIT_LAYERS } from "@/lib/map/featuresAt";
import {
  DOUBLE_CLICK_HINT,
  escapeHtml,
  formatRouteBody,
  formatStationBody,
  popupLink,
  safeHref,
} from "@/lib/map/utils/tooltipFormatting";
import { getNoteTypeLabel } from "@/lib/shared/constants";
import { ROUTE_CLICK_LAYER_ID, ROUTE_LINE_LAYERS } from "@/lib/shared/map/layers";
import type { RegionId } from "@/lib/shared/regions";

interface AdminMapCallbacks {
  onCoordinateClickRef: MutableRefObject<((coordinate: [number, number]) => void) | undefined>;
  onRouteSelectRef: MutableRefObject<((routeId: number | null) => void) | undefined>;
  /** Region the map is showing — decides how a route's popup is labelled. */
  region: RegionId;
}

export function setupAdminMapInteractions(
  mapInstance: maplibreglType.Map,
  { onCoordinateClickRef, onRouteSelectRef, region }: AdminMapCallbacks,
) {
  const hits = (point: maplibreglType.PointLike, layers: string[]) =>
    featuresAt(mapInstance, point, layers).length > 0;

  const setCursor = (cursor: string) => {
    mapInstance.getCanvas().style.cursor = cursor;
  };

  /**
   * The hover popups, one per layer (keyed by class name), so leaving a route does
   * not take down the popup of a station on it that is still under the pointer.
   */
  const hoverPopups = new Map<string, maplibregl.Popup>();
  const showHover = (lngLat: maplibreglType.LngLatLike, className: string, html: string) => {
    hoverPopups.get(className)?.remove();
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 10,
      className,
    })
      .setLngLat(lngLat)
      .setHTML(`<div style="color: var(--color-fg);">${html}</div>`)
      .addTo(mapInstance);
    hoverPopups.set(className, popup);
  };
  const hideHover = (className: string) => {
    hoverPopups.get(className)?.remove();
    hoverPopups.delete(className);
  };

  /** The `hover` feature state of one tiled layer, which its paint reads. */
  const featureHover = (source: string) => {
    let hoveredId: number | string | null = null;
    const setHover = (id: number | string, hover: boolean) =>
      mapInstance.setFeatureState({ source, sourceLayer: source, id }, { hover });
    return {
      enter(id: number | string | undefined) {
        if (id === undefined || id === hoveredId) return;
        if (hoveredId !== null) setHover(hoveredId, false);
        hoveredId = id;
        setHover(id, true);
      },
      leave() {
        if (hoveredId === null) return;
        setHover(hoveredId, false);
        hoveredId = null;
      },
    };
  };
  const partHover = featureHover("railway_parts");
  const noteHover = featureHover("admin_notes");

  // A part click captures the exact coordinate clicked — unless an endpoint, a
  // route or a note is there too, each of which takes the click itself.
  mapInstance.on("click", "railway_parts", (e) => {
    if (hits(e.point, ["route-endpoints", ...ROUTE_HIT_LAYERS, "admin_notes"])) return;
    onCoordinateClickRef.current?.([e.lngLat.lng, e.lngLat.lat]);
  });

  // An endpoint click reuses the endpoint's exact coordinate. The layer is built
  // with the map (empty until the endpoints load), so it can take a layer-scoped
  // handler like any other.
  mapInstance.on("click", "route-endpoints", (e) => {
    const feature = e.features?.[0];
    if (feature?.geometry.type === "Point") {
      onCoordinateClickRef.current?.(feature.geometry.coordinates as [number, number]);
    }
  });

  mapInstance.on("click", ROUTE_CLICK_LAYER_ID, (e) => {
    // Routes pass through their own start/end markers, so a click on an endpoint
    // dot also lands on the route. The endpoint handler already set the coordinate
    // — don't also select the route.
    if (hits(e.point, ["route-endpoints"])) return;
    const feature = e.features?.[0];
    if (!feature || !onRouteSelectRef.current) return;
    // track_id is the feature id, not a property
    onRouteSelectRef.current(Number(feature.id));
    e.preventDefault();
  });

  // A click on nothing at all unselects the route.
  mapInstance.on("click", (e) => {
    if (!hits(e.point, [...ROUTE_HIT_LAYERS, "railway_parts", "route-endpoints"])) {
      onRouteSelectRef.current?.(null);
    }
  });

  mapInstance.on("mouseenter", "railway_parts", (e) => {
    if (hits(e.point, ROUTE_HIT_LAYERS)) return;
    setCursor("pointer");
    partHover.enter(e.features?.[0]?.id);
  });
  mapInstance.on("mouseleave", "railway_parts", () => {
    setCursor("");
    partHover.leave();
  });

  const showRouteHover = (e: maplibreglType.MapLayerMouseEvent) => {
    const properties = e.features?.[0]?.properties;
    if (!properties) return;
    showHover(
      e.lngLat,
      "railway-route-hover-popup",
      formatRouteBody(properties, region, { linkRow: true }),
    );
  };

  mapInstance.on("mouseenter", ROUTE_CLICK_LAYER_ID, (e) => {
    setCursor("pointer");
    showRouteHover(e);
  });
  mapInstance.on("mouseleave", ROUTE_CLICK_LAYER_ID, () => {
    setCursor("");
    hideHover("railway-route-hover-popup");
  });

  // Routes re-shown for reference during a re-pick have no hit area (see
  // useAdminLayerVisibility), so they are read from their lines instead: the popup
  // without the pointer, since a click there does nothing — it neither selects the
  // route nor reaches the part under it.
  const referenceOnly = () =>
    mapInstance.getLayoutProperty(ROUTE_CLICK_LAYER_ID, "visibility") === "none";
  for (const layerId of ROUTE_LINE_LAYERS) {
    mapInstance.on("mouseenter", layerId, (e) => {
      if (referenceOnly()) showRouteHover(e);
    });
    mapInstance.on("mouseleave", layerId, () => {
      if (referenceOnly()) hideHover("railway-route-hover-popup");
    });
  }

  mapInstance.on("mouseenter", "stations", (e) => {
    setCursor("pointer");
    const properties = e.features?.[0]?.properties;
    if (!properties) return;
    showHover(e.lngLat, "station-hover-popup", formatStationBody(properties));
  });
  mapInstance.on("mouseleave", "stations", () => {
    setCursor("");
    hideHover("station-hover-popup");
  });

  mapInstance.on("mouseenter", "route-endpoints", (e) => {
    const properties = e.features?.[0]?.properties;
    if (!properties) return;
    setCursor("pointer");
    const endpointTypeLabel = properties.endpoint_type === "start" ? "Start" : "End";
    showHover(
      e.lngLat,
      "endpoint-hover-popup",
      `<h3 style="font-weight: bold; margin-bottom: 2px;">${endpointTypeLabel} Point</h3>
      <div style="font-size: 0.85rem; color: var(--color-gray-700);">${escapeHtml(properties.route_name)}</div>
      <div style="font-size: 0.75rem; color: var(--color-gray-500); margin-top: 4px;">Click to use this coordinate</div>`,
    );
  });
  mapInstance.on("mouseleave", "route-endpoints", () => {
    setCursor("");
    hideHover("endpoint-hover-popup");
  });

  mapInstance.on("mouseenter", "admin_notes", (e) => {
    setCursor("pointer");
    const feature = e.features?.[0];
    if (!feature) return;
    noteHover.enter(feature.id);

    const properties = feature.properties;
    const updatedAtStr = properties.updated_at
      ? new Date(properties.updated_at).toISOString().replace("T", " ").slice(0, 19)
      : "";
    const source = popupLink(properties.source, "Source ↗", DOUBLE_CLICK_HINT);
    showHover(
      e.lngLat,
      "admin-note-hover-popup",
      `<h3 style="font-weight: bold; margin-bottom: 2px;">Admin Note: ${escapeHtml(getNoteTypeLabel(properties.note_type))}</h3>
      <div style="font-size: 0.85rem; color: var(--color-gray-700);">${escapeHtml(properties.text)}</div>
      ${source ? `<div style="font-size: 0.8rem; margin-top: 4px;">${source}</div>` : ""}
      ${updatedAtStr ? `<div style="font-size: 0.75rem; color: var(--color-gray-500); margin-top: 2px;">Last updated ${updatedAtStr}</div>` : ""}
      <div style="font-size: 0.75rem; color: var(--color-gray-500); margin-top: 2px;">Right-click to edit</div>`,
    );
  });
  mapInstance.on("mouseleave", "admin_notes", () => {
    setCursor("");
    noteHover.leave();
    hideHover("admin-note-hover-popup");
  });

  // Double-click / double-tap a note opens its source link in a new tab
  // (works on touch where the hover popup link can't be tapped).
  mapInstance.on("dblclick", (e) => {
    const note = featuresAt(mapInstance, e.point, ["admin_notes"])[0];
    if (!note) return;
    e.preventDefault();
    const source = note.properties?.source;
    if (safeHref(source)) window.open(source, "_blank", "noopener,noreferrer");
  });
}
