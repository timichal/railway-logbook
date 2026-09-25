/**
 * One highlight set, as children of the route source.
 *
 * What a highlight looks like is `@shared/map/highlightLayers` — the same
 * specifications the web app hands to `addLayer`. The mechanism is all that differs:
 * there the layers are added, filtered and removed on a live map; here a spec spreads
 * into a `<Layer>` and an empty set simply renders nothing.
 *
 * Two pieces make up a set:
 *
 * - The **tile-filter overlay**, one sublayer per usage type (plus a casing under the
 *   dashed and dotted ones), lighting up whole routes by id.
 * - The **partial overlay**, a `<GeoJSONSource>` of cut geometry, for a route covered
 *   only in part — a tile carries one feature per route, so a stretch of one cannot
 *   come from it.
 *
 * `beforeId` is what `moveLayer` is for on the web: the overlay belongs above the
 * route lines and below the station dots, and mounting order alone would not say so
 * once the partial source is a sibling of the vector source rather than a child.
 */
import { GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import {
  createHighlightCasingLayer,
  createHighlightLayer,
  createPartialHighlightLayer,
  highlightVariants,
  partialHighlightData,
  partialHighlightSourceId,
  wholeRouteIds,
} from "@shared/map/highlightLayers";
import type { PartialRouteGeometry } from "@shared/types";
import { Fragment, type ReactNode, useMemo } from "react";

interface HighlightOverlayProps {
  /** Which set this is — `highlighted_routes` or `selected_routes_highlight`. */
  baseId: string;
  /** Every route in the set, stretches included: the ones drawn as a stretch are dropped here. */
  trackIds: number[];
  color: string;
  partials?: PartialRouteGeometry[];
  /** The layer this set is drawn under; see above. */
  beforeId?: string;
}

/**
 * The tile-filter half. A child of the `railway_routes` `<VectorSource>`, which
 * injects the `source` prop — the spec's own `source` agreeing with it is belt and
 * braces.
 */
export function HighlightLayers({
  baseId,
  trackIds,
  color,
  partials = [],
  beforeId,
}: HighlightOverlayProps): ReactNode {
  const ids = useMemo(() => wholeRouteIds(trackIds, partials), [trackIds, partials]);

  if (ids.length === 0) return null;

  return (
    <>
      {highlightVariants().map((variant) => (
        <Fragment key={variant.suffix}>
          {/* Mounted before its own layer, so it lands underneath it. */}
          {variant.casing ? (
            <Layer
              {...createHighlightCasingLayer(baseId, variant, color, ids)}
              beforeId={beforeId}
            />
          ) : null}
          <Layer {...createHighlightLayer(baseId, variant, color, ids)} beforeId={beforeId} />
        </Fragment>
      ))}
    </>
  );
}

/**
 * The stretch half, a sibling of the vector source rather than a child: its geometry
 * is GeoJSON handed over whole, not something the tile can answer for.
 */
export function PartialHighlightSource({
  baseId,
  color,
  partials,
  beforeId,
}: {
  baseId: string;
  color: string;
  partials: PartialRouteGeometry[];
  beforeId?: string;
}): ReactNode {
  const data = useMemo(() => partialHighlightData(partials), [partials]);

  if (partials.length === 0) return null;

  return (
    <GeoJSONSource id={partialHighlightSourceId(baseId)} data={data}>
      <Layer {...createPartialHighlightLayer(baseId, color)} beforeId={beforeId} />
    </GeoJSONSource>
  );
}
