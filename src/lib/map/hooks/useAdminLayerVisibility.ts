import type * as maplibregl from "maplibre-gl";
import { useEffect, useState } from "react";
import {
  ROUTE_CLICK_LAYER_ID,
  ROUTE_LINE_LAYERS,
  SCENIC_LINES_LAYER_ID,
} from "@/lib/shared/map/layers";
import type { Region } from "@/lib/shared/regions";

/**
 * The admin map's layer switches, in the order the controls list them. `offeredIn`
 * hides a switch in regions where its layer never has anything to show.
 */
export const ADMIN_LAYERS = [
  { key: "parts", label: "Railway Parts", layerIds: ["railway_parts"] },
  { key: "routes", label: "Railway Routes", layerIds: ROUTE_LINE_LAYERS },
  {
    key: "scenic",
    label: "Scenic Lines",
    layerIds: [SCENIC_LINES_LAYER_ID],
    offeredIn: (region: Region) => region.hasScenicHighlight,
  },
  { key: "stations", label: "Stations", layerIds: ["stations", "station_labels"] },
  { key: "endpoints", label: "Route Endpoints", layerIds: ["route-endpoints"] },
  { key: "notes", label: "Admin Notes", layerIds: ["admin_notes"] },
] as const;

export type AdminLayerKey = (typeof ADMIN_LAYERS)[number]["key"];
export type AdminLayerVisibility = Record<AdminLayerKey, boolean>;

interface UseAdminLayerVisibilityOptions {
  map: React.MutableRefObject<maplibregl.Map | null>;
  mapLoaded: boolean;
  /** Routes forced hidden: a geometry edit, or the Scenic lines tab (see AdminMap). */
  hideRoutes?: boolean;
}

interface LayerVisibilityState {
  visible: AdminLayerVisibility;
  toggle: (key: AdminLayerKey) => void;
  /**
   * Routes shown and not merely re-ticked for reference during a forced-hidden mode:
   * what may be clicked, and where a searched line's band is drawn — in
   * those modes it would lie over the parts being picked.
   */
  routesInteractive: boolean;
}

/** Visibility switches for the admin map's layers, and the forced-hidden routes mode. */
export function useAdminLayerVisibility({
  map,
  mapLoaded,
  hideRoutes,
}: UseAdminLayerVisibilityOptions): LayerVisibilityState {
  const [visible, setVisible] = useState<AdminLayerVisibility>(() => ({
    ...(Object.fromEntries(ADMIN_LAYERS.map(({ key }) => [key, true])) as AdminLayerVisibility),
    routes: !hideRoutes,
  }));
  const [routesHidden, setRoutesHidden] = useState(!!hideRoutes);
  const [showRoutesBeforeHide, setShowRoutesBeforeHide] = useState(true);
  const routesInteractive = visible.routes && !hideRoutes;

  // Entering a forced-hidden mode unticks Railway Routes, and leaving it puts back
  // what was ticked before. Only the default: re-ticking it mid-mode shows the routes.
  // Adjusted during render rather than in an effect, so the layer is never applied
  // with the stale value for a frame.
  if (!!hideRoutes !== routesHidden) {
    setRoutesHidden(!!hideRoutes);
    if (hideRoutes) setShowRoutesBeforeHide(visible.routes);
    setVisible((v) => ({ ...v, routes: hideRoutes ? false : showRoutesBeforeHide }));
  }

  useEffect(() => {
    const m = map.current;
    if (!m || !mapLoaded) return;

    const setVisibility = (layerId: string, shown: boolean) => {
      if (m.getLayer(layerId)) {
        m.setLayoutProperty(layerId, "visibility", shown ? "visible" : "none");
      }
    };

    for (const { key, layerIds } of ADMIN_LAYERS) {
      for (const id of layerIds) setVisibility(id, visible[key]);
    }
    // Routes re-shown mid-mode are for reference: the wide hit area stays off, so it
    // neither swallows the clicks on the parts beside a route nor selects one. A click
    // on a line itself is still blocked; hovering it shows its popup (see
    // adminMapInteractions).
    setVisibility(ROUTE_CLICK_LAYER_ID, routesInteractive);
  }, [map, mapLoaded, visible, routesInteractive]);

  const toggle = (key: AdminLayerKey) => setVisible((v) => ({ ...v, [key]: !v[key] }));

  return { visible, toggle, routesInteractive };
}
