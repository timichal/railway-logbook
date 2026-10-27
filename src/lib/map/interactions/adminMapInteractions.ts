import type * as maplibreglType from "maplibre-gl";
import type { RefObject } from "react";
import { featuresAt, ROUTE_HIT_LAYERS } from "@/lib/map/featuresAt";
import { createMapHover, type FeatureProperties } from "@/lib/map/interactions/mapHover";
import {
  DOUBLE_CLICK_HINT,
  escapeHtml,
  formatRouteBody,
  formatScenicLineBody,
  formatStationBody,
  popupLink,
  safeHref,
} from "@/lib/map/utils/tooltipFormatting";
import { getNoteTypeLabel } from "@/lib/shared/constants";
import {
  ROUTE_CLICK_LAYER_ID,
  ROUTE_LINE_LAYERS,
  SCENIC_ENDPOINTS_LAYER_ID,
  SCENIC_LINES_LAYER_ID,
} from "@/lib/shared/map/layers";
import type { RegionId } from "@/lib/shared/regions";

/** The dots whose click picks their exact coordinate. */
const ENDPOINT_LAYERS = ["route-endpoints", SCENIC_ENDPOINTS_LAYER_ID];

/**
 * What is drawn over a scenic line and takes a click of its own, so a click there
 * reaches neither the line nor the part under it.
 */
const OVER_SCENIC_LINES = [...ENDPOINT_LAYERS, ...ROUTE_HIT_LAYERS, "admin_notes"];

interface AdminMapCallbacks {
  onCoordinateClickRef: RefObject<((coordinate: [number, number]) => void) | undefined>;
  onRouteSelectRef: RefObject<((routeId: number | null) => void) | undefined>;
  /**
   * Set only while scenic lines can be selected (the Scenic tab, outside a geometry
   * re-pick): a scenic line then takes the click and shows its popup. Otherwise it
   * takes no click, which falls through to the parts under it.
   */
  onScenicLineSelectRef: RefObject<((id: number | null) => void) | undefined>;
  /** Region the map is showing — decides how a route's popup is labelled. */
  region: RegionId;
}

export function setupAdminMapInteractions(
  mapInstance: maplibreglType.Map,
  { onCoordinateClickRef, onRouteSelectRef, onScenicLineSelectRef, region }: AdminMapCallbacks,
) {
  const hits = (point: maplibreglType.PointLike, layers: string[]) =>
    featuresAt(mapInstance, point, layers).length > 0;
  const scenicSelectable = () => onScenicLineSelectRef.current !== undefined;

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

  // The hover popup and cursor (`mapHover.ts`, shared with the user map). A part
  // or a note is lit only while a click would reach it — not under a route, an
  // endpoint or a note drawn over it, which would take the click instead.
  const hover = createMapHover(mapInstance, {
    onSettle: (target) => {
      const lit = (layerId: string) =>
        target?.layerId === layerId ? target.feature.id : undefined;
      const part = lit("railway_parts");
      if (part === undefined) partHover.leave();
      else partHover.enter(part);
      const note = lit("admin_notes");
      if (note === undefined) noteHover.leave();
      else noteHover.enter(note);
    },
  });

  // A part click captures the exact coordinate clicked — unless something drawn over
  // it is there too (`OVER_SCENIC_LINES`, and a selectable scenic line), which takes
  // the click itself.
  mapInstance.on("click", "railway_parts", (e) => {
    const takenBy = scenicSelectable()
      ? [...OVER_SCENIC_LINES, SCENIC_LINES_LAYER_ID]
      : OVER_SCENIC_LINES;
    if (hits(e.point, takenBy)) return;
    onCoordinateClickRef.current?.([e.lngLat.lng, e.lngLat.lat]);
  });

  // A scenic line is under the routes and over the parts, so anything drawn over it
  // takes the click first, as it does from a part.
  mapInstance.on("click", SCENIC_LINES_LAYER_ID, (e) => {
    const select = onScenicLineSelectRef.current;
    const feature = e.features?.[0];
    if (!select || !feature) return;
    if (hits(e.point, OVER_SCENIC_LINES)) return;
    select(Number(feature.id));
  });

  // An endpoint click reuses the endpoint's exact coordinate. The layers are built
  // with the map (empty until the endpoints load), so they can take a layer-scoped
  // handler like any other.
  for (const layerId of ENDPOINT_LAYERS) {
    mapInstance.on("click", layerId, (e) => {
      const feature = e.features?.[0];
      if (feature?.geometry.type === "Point") {
        onCoordinateClickRef.current?.(feature.geometry.coordinates as [number, number]);
      }
    });
  }

  mapInstance.on("click", ROUTE_CLICK_LAYER_ID, (e) => {
    // Routes pass through their own start/end markers, so a click on an endpoint
    // dot also lands on the route. The endpoint handler already set the coordinate
    // — don't also select the route.
    if (hits(e.point, ENDPOINT_LAYERS)) return;
    const feature = e.features?.[0];
    if (!feature || !onRouteSelectRef.current) return;
    // track_id is the feature id, not a property
    onRouteSelectRef.current(Number(feature.id));
    e.preventDefault();
  });

  // A click on nothing at all unselects the route, and the scenic line — unless it
  // lands on a scenic band (wider than the track under it, and selecting a line of
  // its own) or a note, which is something to look at even though it takes no click.
  mapInstance.on("click", (e) => {
    if (hits(e.point, [...ROUTE_HIT_LAYERS, "railway_parts", ...ENDPOINT_LAYERS])) return;
    onRouteSelectRef.current?.(null);
    if (!hits(e.point, [SCENIC_LINES_LAYER_ID, "admin_notes"])) {
      onScenicLineSelectRef.current?.(null);
    }
  });

  // Every `click` below is what the click handlers above do there.
  hover.layer("railway_parts");

  const buildRouteBody = (properties: FeatureProperties) =>
    formatRouteBody(properties, region, { linkRow: true });
  hover.layer(ROUTE_CLICK_LAYER_ID, { buildBody: buildRouteBody });

  // Routes re-shown for reference during a re-pick have no hit area (see
  // useAdminLayerVisibility), so they are read from their lines instead. A click on
  // a Regular one does nothing — it neither selects the route nor reaches the part
  // under it (`ROUTE_HIT_LAYERS`); one on another line reaches the part.
  const referenceOnly = () =>
    mapInstance.getLayoutProperty(ROUTE_CLICK_LAYER_ID, "visibility") === "none";
  for (const layerId of ROUTE_LINE_LAYERS) {
    hover.layer(layerId, {
      buildBody: buildRouteBody,
      click: ROUTE_HIT_LAYERS.includes(layerId) ? "blocks" : "passes",
      when: referenceOnly,
    });
  }

  hover.layer(SCENIC_LINES_LAYER_ID, { buildBody: formatScenicLineBody, when: scenicSelectable });

  // A station takes no click of its own: it goes to the route or part under it.
  hover.layer("stations", {
    className: "station-popup",
    buildBody: formatStationBody,
    click: "passes",
  });

  hover.layer("admin_notes", {
    buildBody: (properties) => {
      const updatedAtStr = properties.updated_at
        ? new Date(properties.updated_at).toISOString().replace("T", " ").slice(0, 19)
        : "";
      const source = popupLink(properties.source, "Source ↗", DOUBLE_CLICK_HINT);
      return `<h3 style="font-weight: bold; margin-bottom: 2px;">Admin Note: ${escapeHtml(getNoteTypeLabel(properties.note_type))}</h3>
      <div style="font-size: 0.85rem; color: var(--color-gray-700);">${escapeHtml(properties.text)}</div>
      ${source ? `<div style="font-size: 0.8rem; margin-top: 4px;">${source}</div>` : ""}
      ${updatedAtStr ? `<div style="font-size: 0.75rem; color: var(--color-gray-500); margin-top: 2px;">Last updated ${updatedAtStr}</div>` : ""}
      <div style="font-size: 0.75rem; color: var(--color-gray-500); margin-top: 2px;">Right-click to edit</div>`;
    },
  });

  const buildEndpointBody = (kind: string, name: unknown, endpointType: unknown) => {
    const endpointTypeLabel = endpointType === "start" ? "Start" : "End";
    return `<h3 style="font-weight: bold; margin-bottom: 2px;">${kind}${endpointTypeLabel} Point</h3>
      <div style="font-size: 0.85rem; color: var(--color-gray-700);">${escapeHtml(name)}</div>
      <div style="font-size: 0.75rem; color: var(--color-gray-500); margin-top: 4px;">Click to use this coordinate</div>`;
  };
  hover.layer("route-endpoints", {
    buildBody: (properties) =>
      buildEndpointBody("", properties.route_name, properties.endpoint_type),
  });
  hover.layer(SCENIC_ENDPOINTS_LAYER_ID, {
    buildBody: (properties) =>
      buildEndpointBody("Scenic Line ", properties.line_name, properties.endpoint_type),
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
