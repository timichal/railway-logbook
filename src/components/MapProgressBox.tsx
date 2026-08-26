"use client";

import { useState } from "react";
import { useLayerPrefs } from "@/lib/map/layerPrefsContext";
import type { UserProgress } from "@/lib/progressQueries";
import { useRegion } from "@/lib/regionContext";
import { iconBtn } from "@/lib/ui/buttonStyles";
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
 * `withLayerToggles` is false on the user map's mobile view, where the switches live
 * in `MobileMenuSheet` instead — a menu costs no map. The shared map has no menu, so
 * it keeps them here at every width.
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
        aria-label={`Completed ${progress.percentage}% — show progress and layers`}
        className="absolute bottom-10 left-3 z-10 min-h-11 px-3 flex items-center gap-1.5 bg-white rounded-full shadow-lg text-black transition-colors hover:bg-gray-50 active:bg-gray-100"
      >
        <span className="font-bold text-green-600 text-base">{progress.percentage}%</span>
        <span className="text-xs text-gray-500">done</span>
      </button>
    );
  }

  return (
    <div
      className={`absolute bg-white p-3 rounded shadow-lg text-black z-10 ${
        isMobile ? "bottom-10 left-3 text-xs" : "bottom-10 right-4"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className={`font-bold mb-2 ${isMobile ? "text-xs" : "text-sm"}`}>Completed</h3>
        {isMobile && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse progress"
            className={`${iconBtn("sm")} -mt-1.5 -mr-1.5 text-lg`}
          >
            &times;
          </button>
        )}
      </div>
      <div className={`font-semibold ${isMobile ? "text-sm" : "text-lg"}`}>
        {progress.completedKm}/{progress.totalKm} km
      </div>
      <div className={`font-bold text-green-600 ${isMobile ? "text-lg" : "text-2xl"}`}>
        {progress.percentage}%
      </div>
      <div className="text-xs text-gray-600 mt-1">
        {progress.completedRoutes}/{progress.totalRoutes} ({progress.routePercentage}%) routes
      </div>
      {withLayerToggles && (
        <div className="mt-2 pt-2 border-t border-gray-200 md:space-y-1">
          <LayerToggles prefs={layerPrefs} region={region} compact />
        </div>
      )}
    </div>
  );
}
