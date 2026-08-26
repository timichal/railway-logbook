"use client";

import { useRegionContext } from "@/lib/regionContext";
import { REGION_IDS, REGIONS } from "@/lib/regions";

interface RegionSwitchProps {
  /** Flag-only buttons, for a cramped navbar. */
  compact?: boolean;
  /** Fill the container and split it evenly — for the mobile menu's own row. */
  stretch?: boolean;
}

/**
 * Segmented control switching the whole page between regions. The map is locked
 * to one region at a time, and every list, stat and search beside it follows.
 */
export default function RegionSwitch({ compact = false, stretch = false }: RegionSwitchProps) {
  const { regionId, setRegion } = useRegionContext();

  return (
    <fieldset
      // Explicit height rather than padding: the flag emoji's line box is not the
      // same as the Latin one, so a py-2 switch came out a hair shorter than the
      // py-2 buttons beside it in the navbar.
      className={`rounded-md border border-gray-300 overflow-hidden ${
        stretch ? "flex w-full" : "inline-flex"
      } ${compact ? "h-11" : "h-10"}`}
      aria-label="Region"
    >
      {REGION_IDS.map((id) => {
        const region = REGIONS[id];
        const isActive = id === regionId;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setRegion(id)}
            aria-pressed={isActive}
            title={region.label}
            // The fieldset clips (`overflow-hidden`, to round the strip's ends), so the
            // base focus ring — drawn 2px *outside* the segment — would be invisible
            // here. Inset it instead; it is the same ring, just on the other side.
            className={`${compact ? "px-3 text-lg" : "px-3 text-sm"} ${stretch ? "flex-1" : ""} inline-flex items-center justify-center font-medium transition-colors focus-visible:-outline-offset-2 border-r border-gray-300 last:border-r-0 ${
              isActive
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900 active:bg-gray-200"
            }`}
          >
            <span aria-hidden="true">{region.flag}</span>
            {!compact && <span className="ml-1.5">{region.label}</span>}
          </button>
        );
      })}
    </fieldset>
  );
}
