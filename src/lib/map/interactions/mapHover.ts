import type * as maplibreglType from "maplibre-gl";
import * as maplibregl from "maplibre-gl";

/** Straight off an MVT feature, so every field is loosely typed. */
export type FeatureProperties = maplibreglType.MapGeoJSONFeature["properties"];

/**
 * What a click on a hovered feature does, which the cursor has to tell truthfully:
 * - `acts` — the feature takes the click: pointer cursor;
 * - `blocks` — the click stops there and does nothing: default cursor, and the
 *   features under it are not hovered either;
 * - `passes` — the click goes through to whatever is under it, which decides the
 *   cursor; the feature still shows its popup.
 */
export type HoverClick = "acts" | "blocks" | "passes";

export interface HoverLayerOptions {
  /** The popup body; without it the layer shows no popup. */
  buildBody?: (properties: FeatureProperties) => string;
  /** The body's content class (default `railway-popup`, styled in globals.css). */
  className?: string;
  /** Default `acts`. */
  click?: HoverClick;
  /** Offered only while this holds. */
  when?: () => boolean;
}

/** A feature under the pointer, as one move offered it. */
export interface HoverTarget {
  /** The style layer it was hit on. */
  layerId: string;
  feature: maplibreglType.MapGeoJSONFeature;
}

export interface MapHover {
  /** Hovers `layerId`'s features, from its `mousemove`. */
  layer: (layerId: string, options?: HoverLayerOptions) => void;
  /** Takes the popup down now, e.g. for a touch sheet opening in its place. */
  hide: () => void;
  dispose: () => void;
}

interface MapHoverOptions {
  /** Asked on every move; while false there is no hover at all (touch). */
  enabled?: () => boolean;
  /**
   * Told what the pointer is on after every move: the topmost feature whose click
   * does not pass through, or null.
   */
  onSettle?: (target: HoverTarget | null) => void;
  /** Called just before a popup is added (not when an open one changes body). */
  onShow?: () => void;
}

interface Offer extends HoverTarget, Required<Pick<HoverLayerOptions, "click">> {
  lngLat: maplibreglType.LngLatLike;
  popup?: () => { className: string; body: string };
}

/**
 * The hover of both maps: one popup with no close button and no buttons, the
 * cursor, and which feature under the pointer they are about.
 *
 * **Driven by `mousemove`, never by `mouseenter` / `mouseleave`.** MapLibre fires
 * those once per *layer*, so sliding from a route straight onto a connected one
 * fires neither, and a popup built on enter kept describing the first route. And
 * one move reaches every layer's handlers in turn, so a `mouseleave` of one layer
 * could undo what another's `mousemove` had just drawn. Instead each layer's
 * `mousemove` only records its offer, and a map-wide `mousemove` settles the move
 * once, in a microtask, after all of them. **The layer drawn on top wins**, read
 * from the style's layer order rather than from the order the handlers happen to
 * be registered in; a move with no offer at all takes the popup down and the cursor
 * back, and so does leaving the canvas.
 *
 * **One popup follows the pointer rather than one per move.** Over the same feature
 * only its position changes; the body is rebuilt and swapped in only when the
 * pointer reaches another feature. A feature is told apart by its layer, its id and
 * its whole property set: the notes tile carries no id at all, and a tile refresh
 * landing under a resting pointer (a journey logged, a login, a country toggled)
 * changes a route's properties without changing its id — keyed on the id alone,
 * the popup would keep the old body until the pointer left. Serialising a handful
 * of scalar properties is still far cheaper than rebuilding the popup's DOM, and
 * only the winner's are serialised. The popup takes no pointer events
 * (`.map-hover-popup`): it sits right at the pointer, and one pixel into it would
 * leave the canvas and take it down, only for the next pixel to bring it back.
 */
export function createMapHover(
  map: maplibreglType.Map,
  { enabled = () => true, onSettle, onShow }: MapHoverOptions = {},
): MapHover {
  let popup: maplibregl.Popup | null = null;
  let popupKey: string | null = null;
  let offers: Offer[] = [];
  let scheduled = false;
  let pointer = false;
  let disposed = false;

  const setPointer = (value: boolean) => {
    if (value === pointer) return;
    pointer = value;
    map.getCanvas().style.cursor = value ? "pointer" : "";
  };

  const hide = () => {
    popup?.remove();
    popup = null;
    popupKey = null;
  };

  const show = (offer: Offer, build: NonNullable<Offer["popup"]>) => {
    const { layerId, feature, lngLat } = offer;
    const key = `${layerId}:${feature.id}:${JSON.stringify(feature.properties)}`;
    if (popup && key === popupKey) {
      popup.setLngLat(lngLat);
      return;
    }

    const { className, body } = build();
    const html = `<div class="${className}" style="color: var(--color-fg);">${body}</div>`;
    if (popup) {
      popup.setHTML(html).setLngLat(lngLat);
    } else {
      onShow?.();
      const added = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: "map-hover-popup",
      })
        .setLngLat(lngLat)
        .setHTML(html)
        .addTo(map);
      // Removed by anything but `hide`, it must not be mistaken for the open one.
      added.on("close", () => {
        if (popup !== added) return;
        popup = null;
        popupKey = null;
      });
      popup = added;
    }
    popupKey = key;
  };

  const settle = (moveOffers: Offer[]) => {
    if (disposed) return;
    if (!enabled()) {
      setPointer(false);
      return;
    }

    // Topmost first. A layer missing from the order (removed since) ranks last.
    const order = map.getLayersOrder();
    const ranked = moveOffers
      .map((offer) => ({ offer, rank: order.indexOf(offer.layerId) }))
      .sort((a, b) => b.rank - a.rank)
      .map(({ offer }) => offer);
    const target = ranked.find((offer) => offer.click !== "passes") ?? null;
    const shown = ranked.find((offer) => offer.popup);

    setPointer(target?.click === "acts");
    onSettle?.(target && { layerId: target.layerId, feature: target.feature });
    if (shown?.popup) show(shown, shown.popup);
    else hide();
  };

  const settleMove = () => {
    scheduled = false;
    const moveOffers = offers;
    offers = [];
    settle(moveOffers);
  };

  const subscriptions = [
    map.on("mousemove", () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(settleMove);
    }),
    map.on("mouseout", () => {
      offers = [];
      settle([]);
    }),
  ];

  const layer = (
    layerId: string,
    { buildBody, className = "railway-popup", click = "acts", when }: HoverLayerOptions = {},
  ) => {
    subscriptions.push(
      map.on("mousemove", layerId, (e) => {
        const feature = e.features?.[0];
        if (!feature || (when && !when())) return;
        offers.push({
          layerId,
          feature,
          click,
          lngLat: e.lngLat,
          popup: buildBody && (() => ({ className, body: buildBody(feature.properties) })),
        });
      }),
    );
  };

  return {
    layer,
    hide,
    dispose: () => {
      hide();
      setPointer(false);
      disposed = true;
      for (const subscription of subscriptions) subscription.unsubscribe();
    },
  };
}
