import type * as maplibreglType from "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import { HIGHLIGHT_LAYER_IDS } from "@/lib/map/hooks/useRouteHighlighting";
import {
  escapeHtml,
  formatRouteMetadataBadges,
  formatRouteTitle,
  POPUP_DIVIDER,
  POPUP_ROW_STYLE,
  safeHref,
} from "@/lib/map/utils/tooltipFormatting";
import type { RegionId } from "@/lib/regions";
import type { SelectedRoute, Station } from "@/lib/types";
import { type ButtonVariant, btn } from "@/lib/ui/buttonStyles";

/** Straight off an MVT feature, so every field is loosely typed. */
type FeatureProperties = maplibreglType.MapGeoJSONFeature["properties"];

/** What a tap on a route would do, as the touch sheet's button has to word it. */
export interface RouteTapAction {
  /** "Add to selection", "Remove from journey" — whatever the tap is about to do. */
  label: string;
}

interface UserMapInteractionCallbacks {
  /**
   * Omitted on the read-only shared map (`/shared/<token>`): nothing can be
   * selected there, so a pointer gets the hover popup and a finger gets an info
   * sheet with no action button — but both still get to read the route.
   */
  onRouteClick?: (feature: SelectedRoute) => void;
  onStationClick?: (station: Station | null) => void;
  /** Region the map is showing — decides how a route's popup is labelled. */
  region: RegionId;
  /**
   * How the touch sheet's action button should read for this route, and null when
   * a tap has nothing to act on (the sidebar is on a tab that ignores route
   * clicks). Only the sheet asks: with a mouse the tap *is* the action, so there
   * is no button to label.
   */
  routeTapAction?: (trackId: number) => RouteTapAction | null;
}

interface SheetAction {
  label: string;
  variant: ButtonVariant;
  onClick: () => void;
}

/**
 * How long after a touch sheet closes a tap still counts as part of the gesture
 * that closed it. Comfortably over the platforms' ~300ms double-tap window, and
 * short enough that a deliberate second tap is not swallowed.
 */
const SHEET_TAP_GRACE_MS = 400;

/**
 * Setup all map interactions for user map
 *
 * **Hover is a pointer affordance, and a finger has no hover.** iOS synthesizes a
 * `mousemove` on tap, so the popups half-worked on a phone: the popup arrived on
 * the same tap that selected the route, and it told the reader to *double-click*
 * to open a link — an instruction with no meaning on touch, served by a `dblclick`
 * handler whose `preventDefault` cost every route its double-tap-to-zoom.
 *
 * So a tap gets a **sheet** instead: the same title, badges and body, plus buttons
 * for the two things a mouse gets by hovering and double-clicking. The tap no
 * longer acts on the route by itself — the button does, which is also what makes
 * "what does tapping this route do" answerable before committing to it. The hover
 * popups and the double-click stay exactly as they were for a pointer; every
 * handler branches on `lastPointerWasTouch`, tracked from the pointer events that
 * precede whatever MapLibre goes on to synthesize.
 */
export function setupUserMapInteractions(
  mapInstance: maplibreglType.Map,
  callbacks: UserMapInteractionCallbacks,
) {
  const { onRouteClick, onStationClick, region, routeTapAction } = callbacks;
  let currentPopup: maplibregl.Popup | null = null;

  // Seeded from the media query so that even a first tap is treated as one, then
  // kept honest by the pointer events themselves — a hybrid laptop goes back to
  // hover popups the moment its mouse moves.
  let lastPointerWasTouch =
    typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;
  const handlePointer = (e: PointerEvent) => {
    lastPointerWasTouch = e.pointerType === "touch";
  };
  const canvasContainer = mapInstance.getCanvasContainer();
  canvasContainer.addEventListener("pointerdown", handlePointer, { passive: true });
  canvasContainer.addEventListener("pointermove", handlePointer, { passive: true });

  const removePopup = () => {
    if (currentPopup) {
      currentPopup.remove();
      currentPopup = null;
    }
  };

  /**
   * **A tap in the sheet is not a tap on the map, and the other way round.**
   *
   * The sheet is hung on its own button, so it sits directly over the route it
   * describes, and the two targets overlap on screen even though they do not in
   * the DOM. Everything below enforces the separation by geometry rather than by
   * trusting where a synthesized event says it landed:
   *
   * - a click whose point falls inside the sheet belongs to the sheet, and the map
   *   handlers ignore it outright;
   * - a click outside it is the dismissal, and nothing else — so the sheet cannot
   *   close and immediately reopen in one gesture;
   * - **but never within `SHEET_TAP_GRACE_MS` of the sheet opening.** A tap that
   *   reaches the map more than once (a compatibility click behind a pointer one,
   *   say) would otherwise have its second delivery dismiss what its first had
   *   just opened. A sheet is not dismissed by the gesture that opened it;
   * - for `SHEET_TAP_GRACE_MS` after a sheet closes, a tap is still the tail of the
   *   gesture that closed it and is swallowed too. That is what stops the second
   *   tap of a double tap — the one that pressed the button — from opening the
   *   sheet straight back up;
   * - and double-click zoom is suspended over the same span, so a press in the
   *   sheet followed by a tap on the map cannot be read as a double tap and zoom.
   */
  let openSheet: maplibregl.Popup | null = null;
  let sheetOpenedAt = Number.NEGATIVE_INFINITY;
  let sheetClosedAt = Number.NEGATIVE_INFINITY;

  let doubleClickZoomSuspended = false;
  let resumeZoomTimer: ReturnType<typeof setTimeout> | null = null;
  const resumeDoubleClickZoom = () => {
    if (!doubleClickZoomSuspended) return;
    doubleClickZoomSuspended = false;
    mapInstance.doubleClickZoom?.enable();
  };
  const suspendDoubleClickZoom = () => {
    if (resumeZoomTimer) {
      clearTimeout(resumeZoomTimer);
      resumeZoomTimer = null;
    }
    if (doubleClickZoomSuspended || !mapInstance.doubleClickZoom?.isEnabled()) return;
    mapInstance.doubleClickZoom.disable();
    doubleClickZoomSuspended = true;
  };

  /**
   * One tap fires every click handler here — the map-wide route one, plus the
   * layer-scoped station and note ones where those were hit — so the verdict is
   * recorded against the DOM event and the rest of them stand down for it.
   */
  let sheetTookEvent: Event | null = null;
  const sheetTookThisClick = (
    e: maplibreglType.MapMouseEvent | maplibreglType.MapLayerMouseEvent,
  ) => {
    if (sheetTookEvent === e.originalEvent) return true;

    let took: boolean;
    if (openSheet) {
      const box = openSheet.getElement()?.getBoundingClientRect();
      const canvas = canvasContainer.getBoundingClientRect();
      // e.point is canvas-relative; the sheet's rect is not.
      const inside =
        !!box &&
        e.point.x >= box.left - canvas.left &&
        e.point.x <= box.right - canvas.left &&
        e.point.y >= box.top - canvas.top &&
        e.point.y <= box.bottom - canvas.top;
      // Inside, the sheet's own listener owns the tap; outside, this is it being
      // dismissed — unless the sheet has only just opened, in which case this is
      // still the gesture that opened it. Either way the map does nothing with it.
      const justOpened = performance.now() - sheetOpenedAt < SHEET_TAP_GRACE_MS;
      if (!inside && !justOpened) openSheet.remove();
      took = true;
    } else {
      took = performance.now() - sheetClosedAt < SHEET_TAP_GRACE_MS;
    }

    if (took) sheetTookEvent = e.originalEvent;
    return took;
  };

  /** The hover popup: no close button, no buttons, gone when the pointer leaves. */
  const openHoverPopup = (lngLat: maplibreglType.LngLatLike, className: string, body: string) => {
    if (currentPopup) currentPopup.remove();
    currentPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
      .setLngLat(lngLat)
      .setHTML(`<div class="${className}" style="color: black;">${body}</div>`)
      .addTo(mapInstance);
  };

  /**
   * The touch sheet: the same body, plus a wrapping row of buttons.
   *
   * **There is no × on it, because every tap ends it.** A tap in the sheet closes
   * it through the listener below, a button having run its action on the way past;
   * a tap outside closes it through `sheetTookThisClick`, which the map's click
   * handlers consult first. One rule, so no press can leave the sheet behind.
   * Both paths close **this** popup, and its `close` event clears whichever of the
   * variables above still point at it.
   *
   * The buttons sit at `sm` and shrink-to-fit rather than at the mobile paths'
   * usual full-width 44pt: this is a popup roughly the width of a phone, and two
   * stacked bars that size read as the point of the sheet rather than as a
   * footnote under the route they describe.
   *
   * **The first button is hung on the tapped point itself**, so the second tap of
   * a double tap presses it without the finger going looking for it — which is
   * what selecting a route is meant to cost. That means anchoring the sheet by
   * something inside it, so it is opened at `center` (one offset solves both axes,
   * unlike the edge anchors) and then measured: the offset that moves the sheet's
   * centre onto its button's centre puts the button on the point. The body ends up
   * above the finger, where it can be read. A sheet with no action to press keeps
   * the ordinary anchored-with-a-tip popup.
   */
  const openTouchSheet = (
    lngLat: maplibreglType.LngLatLike,
    className: string,
    body: string,
    actions: SheetAction[],
  ) => {
    if (currentPopup) currentPopup.remove();

    const content = document.createElement("div");
    content.className = className;
    content.style.color = "black";
    content.innerHTML = body;

    let primaryButton: HTMLButtonElement | null = null;
    if (actions.length > 0) {
      const row = document.createElement("div");
      // Centred, so a one-button sheet sits squarely over the point rather than
      // hanging off to one side of it.
      row.className = "flex flex-wrap justify-center gap-2 mt-3";
      for (const action of actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = btn(action.variant, "sm");
        button.textContent = action.label;
        button.addEventListener("click", action.onClick);
        row.appendChild(button);
        primaryButton ??= button;
      }
      content.appendChild(row);
    }

    const popup = new maplibregl.Popup({
      closeButton: false,
      // Dismissal is `sheetTookThisClick`, not MapLibre's own: its closer is
      // registered on the map during the very click that opens the sheet, and it
      // would race the handlers here over which of them acts on the next tap.
      closeOnClick: false,
      maxWidth: "min(20rem, calc(100vw - 2rem))",
      // Drops the tip a centred sheet has no edge to point from (globals.css).
      className: primaryButton ? "map-touch-sheet-on-point" : undefined,
      anchor: primaryButton ? "center" : undefined,
    })
      .setLngLat(lngLat)
      .setDOMContent(content)
      .addTo(mapInstance);
    currentPopup = popup;
    openSheet = popup;
    sheetOpenedAt = performance.now();
    suspendDoubleClickZoom();
    popup.on("close", () => {
      if (currentPopup === popup) currentPopup = null;
      if (openSheet !== popup) return;
      openSheet = null;
      sheetClosedAt = performance.now();
      resumeZoomTimer = setTimeout(resumeDoubleClickZoom, SHEET_TAP_GRACE_MS);
    });

    const element = popup.getElement();
    element?.addEventListener("click", () => popup.remove());

    if (primaryButton && element) {
      // Both rects come out of the same transformed space, so their difference is
      // the shift in screen pixels that MapLibre's offset takes: `center` put the
      // sheet's middle on the tapped point, and this moves the sheet until the
      // button's middle is what sits there.
      const sheetBox = element.getBoundingClientRect();
      const buttonBox = primaryButton.getBoundingClientRect();
      popup.setOffset([
        sheetBox.left + sheetBox.width / 2 - (buttonBox.left + buttonBox.width / 2),
        sheetBox.top + sheetBox.height / 2 - (buttonBox.top + buttonBox.height / 2),
      ]);
    }
  };

  const openLink = (value: unknown) => {
    if (safeHref(value)) window.open(String(value), "_blank", "noopener,noreferrer");
  };

  /**
   * The body of a route popup, shared by the hover popup and the touch sheet.
   * Title, badge row, then one block per piece of body text — each its own element
   * rather than `<br />`-separated runs, so the note never continues the badge
   * line. `linkRow` is the hover popup's link-plus-instruction line; the sheet
   * carries a button in its place.
   */
  const buildRouteBody = (properties: FeatureProperties, { linkRow }: { linkRow: boolean }) => {
    let body = formatRouteTitle(properties, region);

    body += formatRouteMetadataBadges(
      {
        usage_type: properties.usage_type,
        scenic: properties.scenic,
        line_class: properties.line_class,
        frequency: properties.frequency,
      },
      region,
    );

    if (properties.description) {
      body += `<div style="${POPUP_ROW_STYLE}"><b>Note:</b> ${escapeHtml(properties.description)}</div>`;
    }
    const routeHref = linkRow ? safeHref(properties.link) : "";
    if (routeHref) {
      body += `<div style="${POPUP_ROW_STYLE}"><a href="${routeHref}" target="_blank" rel="noopener noreferrer" style="color: #1d4ed8; text-decoration: underline;">Website</a> <span style="color: #6b7280; font-size: 0.85em;">(double-click to open)</span></div>`;
    }

    // `date` and `journey_name` are populated together from the most-recent
    // logged journey (both NOT NULL in user_journeys), so either both are
    // present or neither is.
    if (properties.date) {
      const dateStr = new Intl.DateTimeFormat("cs-CZ").format(new Date(properties.date));
      body += POPUP_DIVIDER;
      body += `<div style="${POPUP_ROW_STYLE} color: #374151;">Most recent: ${dateStr} (${escapeHtml(properties.journey_name)})</div>`;
    }

    return body;
  };

  const buildStationBody = (properties: FeatureProperties) => {
    if (!properties.name) return "";
    return (
      `<h3 class="font-bold text-base mb-1" style="color: black;">${escapeHtml(properties.name)}</h3>` +
      `<div class="text-xs text-gray-600">Station</div>`
    );
  };

  /** `sourceRow` mirrors `linkRow` above: the sheet gets a button, not a hint. */
  const buildNoteBody = (properties: FeatureProperties, { sourceRow }: { sourceRow: boolean }) => {
    let body = "";
    if (properties.text) {
      body += `<div style="white-space: pre-wrap;">${escapeHtml(properties.text)}</div>`;
    }
    const sourceHref = sourceRow ? safeHref(properties.source) : "";
    if (sourceHref) {
      body += `<div style="margin-top: 6px;"><a href="${sourceHref}" target="_blank" rel="noopener noreferrer" style="color: blue; text-decoration: underline;">Source</a> <span style="color: #6b7280; font-size: 0.85em;">(double-click to open)</span></div>`;
    }
    return body;
  };

  // Click handler for routes — queries all route-related layers (base + click buffer + highlights)
  const handleRouteClick = (e: maplibreglType.MapMouseEvent) => {
    // Map-wide, so this fires for every tap and is where an open sheet is taken
    // away — including a tap on bare map, which the layer-scoped handlers miss.
    if (sheetTookThisClick(e)) return;

    // With a pointer there is nothing to do here on a read-only map; a finger still
    // gets the sheet, which is the only way to read a route where hover cannot.
    if (!onRouteClick && !lastPointerWasTouch) return;

    // Public notes render on top of everything and have no hover on a phone, so on
    // touch their own sheet takes the tap.
    if (lastPointerWasTouch && mapInstance.getLayer("public_notes")) {
      const noteHit = mapInstance.queryRenderedFeatures(e.point, { layers: ["public_notes"] });
      if (noteHit.length > 0) return;
    }

    // A station circle sits on top of the very route it belongs to, and this is a
    // map-wide click while the station handler is layer-scoped, so both fire. The
    // station wins whenever it has something of its own to do — filling a from/to
    // field in the Journey Planner, or (on touch) opening its own sheet.
    if ((onStationClick || lastPointerWasTouch) && mapInstance.getLayer("stations")) {
      const stationHit = mapInstance.queryRenderedFeatures(e.point, { layers: ["stations"] });
      if (stationHit.length > 0) return;
    }

    const routeLayers = ["railway_routes_click", "railway_routes", ...HIGHLIGHT_LAYER_IDS].filter(
      (id) => mapInstance.getLayer(id),
    );
    if (routeLayers.length === 0) return;

    const features = mapInstance.queryRenderedFeatures(e.point, { layers: routeLayers });
    if (features.length === 0) return;

    const feature = features[0];
    const properties = feature.properties;
    if (!properties) return;

    const trackId = feature.id;
    if (!trackId) return;

    const route: SelectedRoute = {
      track_id: Number(trackId),
      from_station: properties.from_station,
      to_station: properties.to_station,
      description: properties.description,
      usage_types: properties.usage_types,
      link: properties.link || null,
      date: properties.date,
      journey_name: properties.journey_name,
      // Deliberately NOT properties.partial: the tile carries the partial flag of
      // the most recent journey on this route, and inheriting it would pre-tick
      // "partial" on a fresh selection just because the route was ridden in part
      // once before. A click is a new ride, whole until said otherwise.
      partial: null,
      length_km: Number(properties.length_km) || 0,
    };

    if (lastPointerWasTouch) {
      const actions: SheetAction[] = [];
      if (onRouteClick) {
        // No `routeTapAction` supplied means every tap selects, so the button is
        // labelled for the only thing it can do.
        const action = routeTapAction
          ? routeTapAction(route.track_id)
          : { label: "Add to selection" };
        if (action) {
          actions.push({
            label: action.label,
            variant: "primary",
            onClick: () => onRouteClick(route),
          });
        }
      }
      if (safeHref(properties.link)) {
        actions.push({
          label: "Website",
          variant: "outline",
          onClick: () => openLink(properties.link),
        });
      }
      openTouchSheet(
        e.lngLat,
        "railway-popup",
        buildRouteBody(properties, { linkRow: false }),
        actions,
      );
      return;
    }

    onRouteClick?.(route);
  };

  // Hover handler for route popups
  const handleRouteMouseMove = (e: maplibreglType.MapLayerMouseEvent) => {
    if (lastPointerWasTouch) return;

    if (!e.features || e.features.length === 0) {
      removePopup();
      return;
    }

    const properties = e.features[0].properties;
    if (!properties) return;

    openHoverPopup(e.lngLat, "railway-popup", buildRouteBody(properties, { linkRow: true }));
  };

  // Hover handler for station popups (takes precedence)
  const handleStationMouseMove = (e: maplibreglType.MapLayerMouseEvent) => {
    if (lastPointerWasTouch) return;
    if (!e.features || e.features.length === 0) return;

    const properties = e.features[0].properties;
    if (!properties) return;

    openHoverPopup(e.lngLat, "station-popup", buildStationBody(properties));
  };

  // Cursor handlers for routes
  const handleRouteMouseEnter = () => {
    mapInstance.getCanvas().style.cursor = "pointer";
  };

  const handleRouteMouseLeave = () => {
    mapInstance.getCanvas().style.cursor = "";
    // A tap synthesizes a mouseleave of its own; letting it through would take the
    // sheet away in the very gesture that opened it.
    if (!lastPointerWasTouch) removePopup();
  };

  // Hover handler for public note popups (read-only: text + optional source link)
  const handleNoteMouseMove = (e: maplibreglType.MapLayerMouseEvent) => {
    if (lastPointerWasTouch) return;
    if (!e.features || e.features.length === 0) return;

    const properties = e.features[0].properties;
    if (!properties) return;

    openHoverPopup(
      e.lngLat,
      "railway-popup",
      `<div style="max-width: 260px;">${buildNoteBody(properties, { sourceRow: true })}</div>`,
    );
  };

  // Tap handler for public notes — the touch half of the hover popup above.
  const handleNoteClick = (e: maplibreglType.MapLayerMouseEvent) => {
    if (sheetTookThisClick(e)) return;
    if (!lastPointerWasTouch) return;
    if (!e.features || e.features.length === 0) return;

    const properties = e.features[0].properties;
    if (!properties) return;

    const actions: SheetAction[] = [];
    if (safeHref(properties.source)) {
      actions.push({
        label: "Source",
        variant: "outline",
        onClick: () => openLink(properties.source),
      });
    }
    openTouchSheet(
      e.lngLat,
      "railway-popup",
      buildNoteBody(properties, { sourceRow: false }),
      actions,
    );
  };

  const handleNoteMouseEnter = () => {
    mapInstance.getCanvas().style.cursor = "pointer";
  };

  const handleNoteMouseLeave = () => {
    mapInstance.getCanvas().style.cursor = "";
    if (!lastPointerWasTouch) removePopup();
  };

  // Cursor handlers for stations
  const handleStationMouseEnter = () => {
    mapInstance.getCanvas().style.cursor = "pointer";
  };

  const handleStationMouseLeave = () => {
    mapInstance.getCanvas().style.cursor = "";
    if (!lastPointerWasTouch) removePopup();
  };

  // Click handler for stations (Journey Planner)
  const handleStationClick = (e: maplibreglType.MapLayerMouseEvent) => {
    if (sheetTookThisClick(e)) return;
    if (!e.features || e.features.length === 0) return;

    const feature = e.features[0];
    const properties = feature.properties;
    const geometry = feature.geometry;

    if (!properties) return;

    // On touch this is the only way to read a station's name. The tap still fills
    // the planner field below — a text field is cheap to change, so there is
    // nothing here worth putting behind a button of its own.
    if (lastPointerWasTouch) {
      openTouchSheet(e.lngLat, "station-popup", buildStationBody(properties), []);
    }

    if (!onStationClick || !geometry || geometry.type !== "Point") return;

    // Validate station data before creating Station object
    if (!properties.id || !properties.name || !geometry.coordinates) return;

    // Convert to Station type
    const station: Station = {
      id: properties.id,
      name: properties.name,
      coordinates: geometry.coordinates as [number, number],
    };

    onStationClick(station);
  };

  // Double-click opens a feature's link in a new tab, and prevents the default
  // double-click zoom on routes (a fast select/unselect also fires dblclick).
  const handleDblClick = (e: maplibreglType.MapMouseEvent) => {
    // Touch has the sheet's buttons for this, so there is nothing left to add —
    // and the preventDefault below would cost every route its double-tap-to-zoom.
    if (lastPointerWasTouch) return;

    // Public notes render on top — check them first
    if (mapInstance.getLayer("public_notes")) {
      const notes = mapInstance.queryRenderedFeatures(e.point, { layers: ["public_notes"] });
      if (notes.length > 0) {
        e.preventDefault();
        openLink(notes[0].properties?.source);
        return;
      }
    }

    const routeLayers = ["railway_routes_click", "railway_routes", ...HIGHLIGHT_LAYER_IDS].filter(
      (id) => mapInstance.getLayer(id),
    );
    if (routeLayers.length === 0) return;
    const features = mapInstance.queryRenderedFeatures(e.point, { layers: routeLayers });
    if (features.length > 0) {
      e.preventDefault();
      openLink(features[0].properties?.link);
    }
  };
  mapInstance.on("dblclick", handleDblClick);

  // Attach route click as general map handler (works through highlight layers on top).
  // Hover/cursor handlers fire from the wide click-buffer layer so thin visible
  // lines don't make hover/cursor feedback finicky.
  mapInstance.on("click", handleRouteClick);
  mapInstance.on("mousemove", "railway_routes_click", handleRouteMouseMove);
  mapInstance.on("mouseenter", "railway_routes_click", handleRouteMouseEnter);
  mapInstance.on("mouseleave", "railway_routes_click", handleRouteMouseLeave);

  // Attach station handlers (added after routes, so they take precedence due to layer order)
  mapInstance.on("click", "stations", handleStationClick);
  mapInstance.on("mousemove", "stations", handleStationMouseMove);
  mapInstance.on("mouseenter", "stations", handleStationMouseEnter);
  mapInstance.on("mouseleave", "stations", handleStationMouseLeave);

  // Attach public note handlers (notes render on top, so these take precedence)
  mapInstance.on("click", "public_notes", handleNoteClick);
  mapInstance.on("mousemove", "public_notes", handleNoteMouseMove);
  mapInstance.on("mouseenter", "public_notes", handleNoteMouseEnter);
  mapInstance.on("mouseleave", "public_notes", handleNoteMouseLeave);

  // Cleanup function
  return () => {
    removePopup();
    // The sheet's own close handler schedules this; tearing down mid-sheet would
    // otherwise leave double-click zoom off for good.
    if (resumeZoomTimer) clearTimeout(resumeZoomTimer);
    resumeDoubleClickZoom();
    canvasContainer.removeEventListener("pointerdown", handlePointer);
    canvasContainer.removeEventListener("pointermove", handlePointer);
    // Remove route handlers
    mapInstance.off("dblclick", handleDblClick);
    mapInstance.off("click", handleRouteClick);
    mapInstance.off("mousemove", "railway_routes_click", handleRouteMouseMove);
    mapInstance.off("mouseenter", "railway_routes_click", handleRouteMouseEnter);
    mapInstance.off("mouseleave", "railway_routes_click", handleRouteMouseLeave);
    // Remove station handlers
    mapInstance.off("click", "stations", handleStationClick);
    mapInstance.off("mousemove", "stations", handleStationMouseMove);
    mapInstance.off("mouseenter", "stations", handleStationMouseEnter);
    mapInstance.off("mouseleave", "stations", handleStationMouseLeave);
    // Remove public note handlers
    mapInstance.off("click", "public_notes", handleNoteClick);
    mapInstance.off("mousemove", "public_notes", handleNoteMouseMove);
    mapInstance.off("mouseenter", "public_notes", handleNoteMouseEnter);
    mapInstance.off("mouseleave", "public_notes", handleNoteMouseLeave);
  };
}
