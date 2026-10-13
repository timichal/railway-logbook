"use client";

import { useState } from "react";
import LayerToggles from "@/components/map/LayerToggles";
import { useLayerPrefs } from "@/lib/map/layerPrefsContext";
import type { UserProgress } from "@/lib/progressQueries";
import { useRegion } from "@/lib/regionContext";
import { btn } from "@/lib/ui/buttonStyles";

/**
 * The map's bottom-corner progress box and its layer switches.
 *
 * Shared by `RailwayMap` and `PublicRailwayMap` rather than copied into both:
 * a shared map showing different numbers or different toggles from its owner's is a
 * bug nobody notices until someone opens the link.
 *
 * The layer switches are the shared map's alone: the user map moved them into the
 * sidebar's Map & Stats tab, which the shared map has none of. So the prop stays rather than
 * the switches being deleted outright, and it is `false` on every other caller.
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
 *
 * A failed request doesn't hide anything: earlier figures stay, marked out of date,
 * and with none to show the box says so. Either way it offers Retry, since nothing
 * else asks again until a country toggle or a logged ride happens to.
 */

interface MapProgressBoxProps {
  /** Null until a request for this map has succeeded. */
  progress: UserProgress | null;
  /** The newest request failed: the figures, if any, are an older answer. */
  failed: boolean;
  /** A request is out, whatever started it. */
  pending: boolean;
  onRetry: () => void;
  isMobile: boolean;
  /** Draw the layer switches inside the box (false where a menu carries them). */
  withLayerToggles: boolean;
}

/** What the box can say about its figures, in each of the places it says it. */
const STATUS_TEXT = {
  current: { pill: "done", failure: null },
  outdated: { pill: "not up to date", failure: "Couldn't update — not current" },
  unavailable: { pill: "Progress unavailable", failure: "Couldn't load progress" },
} as const;

export default function MapProgressBox({
  progress,
  failed,
  pending,
  onRetry,
  isMobile,
  withLayerToggles,
}: MapProgressBoxProps) {
  const region = useRegion();
  const layerPrefs = useLayerPrefs();
  // Expanded rather than collapsed, so the pill follows `isMobile` as it is now
  // rather than as it was when the box mounted: the box is there from the first
  // render, before useIsMobile may have settled
  const [expanded, setExpanded] = useState(false);

  const text = STATUS_TEXT[!progress ? "unavailable" : failed ? "outdated" : "current"];
  const summary = progress
    ? `Completed ${progress.percentage}%${failed ? ` (${text.pill})` : ""}`
    : text.pill;
  // Only a failure that is not being retried is news; "Updating…" stays silent
  const failureNote = pending ? null : text.failure;

  // Mounted for as long as the box could be, failure or not: a live region that
  // appears together with its first message is usually not announced
  const announcer = (
    <div className="sr-only" aria-live="polite">
      {failureNote}
    </div>
  );

  // Nothing to show until the first answer, or the first failure, is in
  if (!progress && !failed) return announcer;

  if (isMobile && !expanded) {
    return (
      <>
        {announcer}
        <button
          type="button"
          // Opening a pill that says it is out of date asks again: the box then shows
          // the attempt, and the Retry button if that fails too
          onClick={() => {
            setExpanded(true);
            if (failed && !pending) onRetry();
          }}
          aria-expanded={false}
          aria-label={`${summary} — show progress and layers`}
          data-progress-box
          className="absolute bottom-[calc(var(--sheet-visible,0px)+3rem)] left-3 z-10 min-h-11 px-3 flex items-center gap-1.5 bg-surface rounded-full shadow-lg text-fg transition-colors hover:bg-gray-50 active:bg-gray-100"
        >
          {progress && (
            <span className={`font-bold text-base ${failed ? "text-gray-500" : "text-green-600"}`}>
              {progress.percentage}%
            </span>
          )}
          <span className="text-xs text-gray-500">{text.pill}</span>
        </button>
      </>
    );
  }

  const stats = (
    <>
      <h3 className={`font-bold ${progress ? "mb-2" : ""} ${isMobile ? "text-xs" : "text-sm"}`}>
        {progress ? "Completed" : "Progress"}
      </h3>
      {progress && (
        <>
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
      )}
    </>
  );

  // Outside the mobile collapse button, as the layer switches are: a button can't
  // hold another, and tapping Retry must not shut the box
  const failure =
    failed &&
    (pending ? (
      <div className="mt-1 text-xs text-gray-600">Updating…</div>
    ) : (
      <div
        className={`mt-1 text-xs text-amber-700 ${isMobile ? "space-y-1.5" : "flex items-center gap-2"}`}
      >
        <div>{failureNote}</div>
        <button
          type="button"
          onClick={onRetry}
          className={`${btn("outline", isMobile ? "lg" : "xs")} ${isMobile ? "w-full" : ""}`}
        >
          Retry
        </button>
      </div>
    ));

  return (
    <>
      {announcer}
      <div
        data-progress-box
        className={`absolute bg-surface p-3 rounded shadow-lg text-fg z-10 ${
          isMobile
            ? "bottom-[calc(var(--sheet-visible,0px)+3rem)] left-3 text-xs"
            : "bottom-10 right-4"
        }`}
      >
        {isMobile ? (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-expanded={true}
            aria-label={`${summary} — hide progress`}
            className="block w-full text-left"
          >
            {stats}
          </button>
        ) : (
          stats
        )}
        {failure}
        {withLayerToggles && (
          <div className="mt-2 pt-2 border-t border-gray-200 md:space-y-1">
            <LayerToggles prefs={layerPrefs} region={region} compact withOrdinaryTypes />
          </div>
        )}
      </div>
    </>
  );
}
