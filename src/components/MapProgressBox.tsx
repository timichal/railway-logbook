"use client";

import { useState } from "react";
import { useLayerPrefs } from "@/lib/map/layerPrefsContext";
import type { UserProgress } from "@/lib/progressQueries";
import { useRegion } from "@/lib/regionContext";
import LayerToggles from "./LayerToggles";

/**
 * The map's bottom-corner progress box and its layer switches.
 *
 * Shared by `VectorRailwayMap` and `PublicRailwayMap` rather than copied into both:
 * a shared map showing different numbers or different toggles from its owner's is a
 * bug nobody notices until someone opens the link.
 *
 * On mobile it **collapses to a percentage pill** (the pattern `AdminLayerControls`
 * already uses): the box permanently ate a corner of an already-short map. The pill
 * still carries the one number worth glancing at.
 *
 * The same tap opens and closes it — the numbers themselves are the control, so
 * there is no close affordance to aim at. A tiny × in the corner of a box that is
 * already only a few taps wide is the smallest target on the map, and it asks the
 * thumb to hit something more precise than the pill that opened it. The layer
 * switches sit outside the button, since flicking one must not shut the box.
 */

interface MapProgressBoxProps {
  progress: UserProgress;
  isMobile: boolean;
  /** Draw the layer switches inside the box (false where a menu carries them). */
  withLayerToggles: boolean;
}

export default function MapProgressBox({
  progress,
  isMobile,
  withLayerToggles,
}: MapProgressBoxProps) {
  const region = useRegion();
  const layerPrefs = useLayerPrefs();
  const [collapsed, setCollapsed] = useState(isMobile);

  if (isMobile && collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-expanded={false}
        aria-label={`Completed ${progress.percentage}% — show progress and layers`}
        className="absolute bottom-12 left-3 z-10 min-h-11 px-3 flex items-center gap-1.5 bg-white rounded-full shadow-lg text-black transition-colors hover:bg-gray-50 active:bg-gray-100"
      >
        <span className="font-bold text-green-600 text-base">{progress.percentage}%</span>
        <span className="text-xs text-gray-500">done</span>
      </button>
    );
  }

  const stats = (
    <>
      <h3 className={`font-bold mb-2 ${isMobile ? "text-xs" : "text-sm"}`}>Completed</h3>
      <div className={`font-semibold ${isMobile ? "text-sm" : "text-lg"}`}>
        {progress.completedKm}/{progress.totalKm} km
      </div>
      <div className={`font-bold text-green-600 ${isMobile ? "text-lg" : "text-2xl"}`}>
        {progress.percentage}%
      </div>
      <div className="text-xs text-gray-600 mt-1">
        {progress.completedRoutes}/{progress.totalRoutes} ({progress.routePercentage}%) routes
      </div>
    </>
  );

  return (
    <div
      className={`absolute bg-white p-3 rounded shadow-lg text-black z-10 ${
        isMobile ? "bottom-12 left-3 text-xs" : "bottom-10 right-4"
      }`}
    >
      {isMobile ? (
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-expanded={true}
          aria-label={`Completed ${progress.percentage}% — hide progress`}
          className="block w-full text-left"
        >
          {stats}
        </button>
      ) : (
        stats
      )}
      {withLayerToggles && (
        <div className="mt-2 pt-2 border-t border-gray-200 md:space-y-1">
          <LayerToggles prefs={layerPrefs} region={region} compact />
        </div>
      )}
    </div>
  );
}
