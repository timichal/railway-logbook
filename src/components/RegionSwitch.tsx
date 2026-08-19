"use client";

import { useRegionContext } from "@/lib/regionContext";
import { REGION_IDS, REGIONS } from "@/lib/regions";

interface RegionSwitchProps {
  /** Flag-only buttons, for the cramped mobile navbar. */
  compact?: boolean;
}

/**
 * Segmented control switching the whole page between regions. The map is locked
 * to one region at a time, and every list, stat and search beside it follows.
 */
export default function RegionSwitch({ compact = false }: RegionSwitchProps) {
  const { regionId, setRegion } = useRegionContext();

  return (
    <fieldset
      className="inline-flex rounded-md border border-gray-300 overflow-hidden"
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
            className={`${compact ? "px-2 py-1 text-base" : "px-3 py-2 text-sm"} font-medium cursor-pointer border-r border-gray-300 last:border-r-0 ${
              isActive
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900"
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
