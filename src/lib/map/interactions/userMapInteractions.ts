import type * as maplibreglType from "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import { featuresAt, ROUTE_HIT_LAYERS } from "@/lib/map/featuresAt";
import {
  HIGHLIGHT_LAYER_IDS,
  PARTIAL_HIGHLIGHT_LAYER_IDS,
} from "@/lib/map/hooks/useRouteHighlighting";
import { createMapHover, type FeatureProperties } from "@/lib/map/interactions/mapHover";
import {
  DOUBLE_CLICK_HINT,
  escapeHtml,
  formatRouteBody,
  formatStationBody,
  popupLink,
  safeHref,
} from "@/lib/map/utils/tooltipFormatting";
import { ROUTE_CLICK_LAYER_ID } from "@/lib/shared/map/layers";
import type { RegionId } from "@/lib/shared/regions";
import type { SelectedRoute, Station } from "@/lib/shared/types";
import { type ButtonVariant, btn } from "@/lib/ui/buttonStyles";

/** What a tap on a route would do, as the touch sheet's button has to word it. */
interface RouteTapAction {
  /** "Add to selection", "Remove from journey" — whatever the tap is about to do. */
  label: string;
}

export interface UserMapInteractionCallbacks {
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
 * handler, and the hover, branches on `lastPointerWasTouch`, tracked from the
 * pointer events that precede whatever MapLibre goes on to synthesize.
 *
 * The callbacks are asked for afresh on every event rather than taken once here,
 * so the handlers are attached once per map: re-attaching them whenever a callback
 * changed (a sidebar tab switch, a journey card opening) took down whatever popup
 * or sheet was open along with the old set.
 */
export function setupUserMapInteractions(
  mapInstance: maplibreglType.Map,
  getCallbacks: () => UserMapInteractionCallbacks,
) {
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

  /**
   * The hover popup and cursor (`mapHover.ts`, shared with the admin map). A
   * finger has no hover: on touch they are left alone, so a tap's synthesized
   * `mousemove` can neither open a popup nor take the sheet away. A popup opening
   * for a mouse that moved after a tap takes the sheet's place.
   */
  const hover = createMapHover(mapInstance, {
    enabled: () => !lastPointerWasTouch,
    onShow: () => openSheet?.remove(),
  });

  /** Whatever popup is open, the hover popup or the sheet. */
  const removePopup = () => {
    hover.hide();
    openSheet?.remove();
  };

  /**
   * The touch sheet: the same body, plus a wrapping row of buttons.
   *
   * **There is no × on it, because every tap ends it.** A tap in the sheet closes
   * it through the listener below, a button having run its action on the way past;
   * a tap outside closes it through `sheetTookThisClick`, which the map's click
   * handlers consult first. One rule, so no press can leave the sheet behind.
   * Both paths close **this** popup, and its `close` event clears `openSheet` if
   * it still points at it.
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
    removePopup();

    const content = document.createElement("div");
    content.className = className;
    content.style.color = "var(--color-fg)";
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
    openSheet = popup;
    sheetOpenedAt = performance.now();
    suspendDoubleClickZoom();
    popup.on("close", () => {
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

  /** The route popup's body; the sheet carries a button in place of the link row. */
  const buildRouteBody = (properties: FeatureProperties, { linkRow }: { linkRow: boolean }) =>
    formatRouteBody(properties, getCallbacks().region, { linkRow, linkHint: DOUBLE_CLICK_HINT });

  /** `sourceRow` mirrors `linkRow` above: the sheet gets a button, not a hint. */
  const buildNoteBody = (properties: FeatureProperties, { sourceRow }: { sourceRow: boolean }) => {
    let body = "";
    if (properties.text) {
      body += `<div style="white-space: pre-wrap;">${escapeHtml(properties.text)}</div>`;
    }
    const source = sourceRow ? popupLink(properties.source, "Source", DOUBLE_CLICK_HINT) : "";
    if (source) body += `<div style="margin-top: 6px;">${source}</div>`;
    return body;
  };

  /**
   * The route under a point, through the click buffer and the highlights on top.
   * A highlighted stretch is its own GeoJSON carrying only the route's id, so the
   * route is read from the tile — loaded, since the stretch is on screen, and found
   * even while its usage type is switched off the map, which is when the stretch is
   * the only thing there to tap.
   */
  const routeFeatureAt = (point: maplibreglType.PointLike) => {
    const feature = featuresAt(mapInstance, point, [
      ...PARTIAL_HIGHLIGHT_LAYER_IDS,
      ...ROUTE_HIT_LAYERS,
      ...HIGHLIGHT_LAYER_IDS,
    ])[0];
    if (!feature || feature.source === "railway_routes") return feature;
    return mapInstance.querySourceFeatures("railway_routes", {
      sourceLayer: "railway_routes",
      filter: ["==", ["id"], Number(feature.id)],
    })[0];
  };

  const handleRouteClick = (e: maplibreglType.MapMouseEvent) => {
    // Map-wide, so this fires for every tap and is where an open sheet is taken
    // away — including a tap on bare map, which the layer-scoped handlers miss.
    if (sheetTookThisClick(e)) return;

    const callbacks = getCallbacks();
    const { onRouteClick, onStationClick } = callbacks;

    // With a pointer there is nothing to do here on a read-only map; a finger still
    // gets the sheet, which is the only way to read a route where hover cannot.
    if (!onRouteClick && !lastPointerWasTouch) return;

    // Public notes render on top of everything and have no hover on a phone, so on
    // touch their own sheet takes the tap.
    if (lastPointerWasTouch && featuresAt(mapInstance, e.point, ["public_notes"]).length > 0) {
      return;
    }

    // A station circle sits on top of the very route it belongs to, and this is a
    // map-wide click while the station handler is layer-scoped, so both fire. The
    // station wins whenever it has something of its own to do — filling a from/to
    // field in the Journey Planner, or (on touch) opening its own sheet.
    if (
      (onStationClick || lastPointerWasTouch) &&
      featuresAt(mapInstance, e.point, ["stations"]).length > 0
    ) {
      return;
    }

    const feature = routeFeatureAt(e.point);
    const properties = feature?.properties;
    const trackId = feature?.id;
    if (!properties || !trackId) return;

    const route: SelectedRoute = {
      track_id: Number(trackId),
      name: properties.name ?? null,
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
      // No `routeTapAction` supplied means every tap selects, so the button is
      // labelled for the only thing it can do.
      const tapLabel = ({ routeTapAction }: UserMapInteractionCallbacks) =>
        routeTapAction ? (routeTapAction(route.track_id)?.label ?? null) : "Add to selection";
      const label = onRouteClick ? tapLabel(callbacks) : null;
      if (label) {
        actions.push({
          label,
          variant: "primary",
          // The sheet outlives a sidebar tab switch or a journey card opening, either
          // of which changes what a press does. So the press asks again, and acts
          // only if the answer is still what the button says; otherwise the tap just
          // closes the sheet, as every tap in it does.
          onClick: () => {
            const current = getCallbacks();
            if (current.onRouteClick && tapLabel(current) === label) {
              current.onRouteClick(route);
            }
          },
        });
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

  // Hover and cursor go off the wide click buffer, so the thin visible lines don't
  // make them finicky.
  hover.layer(ROUTE_CLICK_LAYER_ID, {
    buildBody: (properties) => buildRouteBody(properties, { linkRow: true }),
  });
  hover.layer("stations", { className: "station-popup", buildBody: formatStationBody });
  // Read-only: text + optional source link.
  hover.layer("public_notes", {
    buildBody: (properties) =>
      `<div style="max-width: 260px;">${buildNoteBody(properties, { sourceRow: true })}</div>`,
  });

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
      openTouchSheet(e.lngLat, "station-popup", formatStationBody(properties), []);
    }

    const { onStationClick } = getCallbacks();
    if (!onStationClick || !geometry || geometry.type !== "Point") return;

    if (!properties.id || !properties.name || !geometry.coordinates) return;

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
    const note = featuresAt(mapInstance, e.point, ["public_notes"])[0];
    if (note) {
      e.preventDefault();
      openLink(note.properties?.source);
      return;
    }

    const route = routeFeatureAt(e.point);
    if (route) {
      e.preventDefault();
      openLink(route.properties?.link);
    }
  };

  // The route click is map-wide, so it works through the highlight layers on top
  // and sees every tap (see `sheetTookThisClick`).
  const subscriptions = [
    mapInstance.on("dblclick", handleDblClick),
    mapInstance.on("click", handleRouteClick),
    mapInstance.on("click", "stations", handleStationClick),
    mapInstance.on("click", "public_notes", handleNoteClick),
  ];

  return () => {
    hover.dispose();
    openSheet?.remove();
    // The sheet's own close handler schedules this; tearing down mid-sheet would
    // otherwise leave double-click zoom off for good.
    if (resumeZoomTimer) clearTimeout(resumeZoomTimer);
    resumeDoubleClickZoom();
    canvasContainer.removeEventListener("pointerdown", handlePointer);
    canvasContainer.removeEventListener("pointermove", handlePointer);
    for (const subscription of subscriptions) subscription.unsubscribe();
  };
}
