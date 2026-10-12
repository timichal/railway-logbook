import type * as maplibreglType from "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import type { MutableRefObject } from "react";
import {
  DOUBLE_CLICK_HINT,
  escapeHtml,
  formatRouteBody,
  formatStationBody,
  popupLink,
  safeHref,
} from "@/lib/map/utils/tooltipFormatting";
import { getNoteTypeLabel } from "@/lib/shared/constants";
import type { RegionId } from "@/lib/shared/regions";

interface AdminMapCallbacks {
  onCoordinateClickRef: MutableRefObject<((coordinate: [number, number]) => void) | undefined>;
  onRouteSelectRef: MutableRefObject<((routeId: number | null) => void) | undefined>;
  /** Region the map is showing — decides how a route's popup is labelled. */
  region: RegionId;
}

/** A route's wide click buffer included, so a route always wins over the part under it. */
const ROUTE_LAYERS = ["railway_routes_click", "railway_routes"];

export function setupAdminMapInteractions(
  mapInstance: maplibreglType.Map,
  { onCoordinateClickRef, onRouteSelectRef, region }: AdminMapCallbacks,
) {
  const hits = (point: maplibreglType.PointLike, layers: string[]) => {
    const present = layers.filter((id) => mapInstance.getLayer(id));
    return (
      present.length > 0 && mapInstance.queryRenderedFeatures(point, { layers: present }).length > 0
    );
  };

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
    if (hits(e.point, ["route-endpoints", ...ROUTE_LAYERS, "admin_notes"])) return;
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

  mapInstance.on("click", "railway_routes_click", (e) => {
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
    if (!hits(e.point, [...ROUTE_LAYERS, "railway_parts", "route-endpoints"])) {
      onRouteSelectRef.current?.(null);
    }
  });

  mapInstance.on("mouseenter", "railway_parts", (e) => {
    if (hits(e.point, ROUTE_LAYERS)) return;
    setCursor("pointer");
    partHover.enter(e.features?.[0]?.id);
  });
  mapInstance.on("mouseleave", "railway_parts", () => {
    setCursor("");
    partHover.leave();
  });

  mapInstance.on("mouseenter", "railway_routes_click", (e) => {
    setCursor("pointer");
    const properties = e.features?.[0]?.properties;
    if (!properties) return;
    showHover(
      e.lngLat,
      "railway-route-hover-popup",
      formatRouteBody(properties, region, { linkRow: true }),
    );
  });
  mapInstance.on("mouseleave", "railway_routes_click", () => {
    setCursor("");
    hideHover("railway-route-hover-popup");
  });

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
    if (!mapInstance.getLayer("admin_notes")) return;
    const note = mapInstance.queryRenderedFeatures(e.point, { layers: ["admin_notes"] })[0];
    if (!note) return;
    e.preventDefault();
    const source = note.properties?.source;
    if (safeHref(source)) window.open(source, "_blank", "noopener,noreferrer");
  });
}
