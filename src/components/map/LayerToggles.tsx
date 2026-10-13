"use client";

import ToggleSwitch from "@/components/ui/ToggleSwitch";
import type { LayerPrefs } from "@/lib/map/layerPrefs";
import { switchableUsageTypes, usageTypeLayerPref } from "@/lib/shared/map/layerPrefs";
import { isOrdinaryUsage, type Region, regionUsagePluralLabel } from "@/lib/shared/regions";

/**
 * The user map's layer switches, in whichever container asks for them: the
 * sidebar's Map & Stats tab, or the shared map's progress box (`compact`), that
 * being the one map with no sidebar of its own.
 *
 * One component rather than two copies, because the region rules live here — the
 * usage types are named as the region names them (`regionUsagePluralLabel`, which
 * is how Japan's Special switch reads "Non-JR lines"), and not every region offers
 * the scenic lines (`Region.hasScenicHighlight`) — and a menu that offered a
 * toggle the map ignores would be worse than no switch.
 *
 * **A usage type the region counts as ordinary service is not switched here** but
 * ticked further down the same tab beside its numbers (Japan's JR and non-JR
 * lines), as Europe's countries are — so the switches carry Heritage alone there.
 * The shared map has no such tab, so it asks for them here (`withOrdinaryTypes`).
 */

interface LayerTogglesProps {
  prefs: LayerPrefs & { toggle: (key: keyof LayerPrefs) => void };
  region: Region;
  compact?: boolean;
  /** Also switch the region's ordinary usage types, where nothing else does. */
  withOrdinaryTypes?: boolean;
}

export default function LayerToggles({
  prefs,
  region,
  compact = false,
  withOrdinaryTypes = false,
}: LayerTogglesProps) {
  const usageTypes = switchableUsageTypes(region.id).filter(
    (type) => withOrdinaryTypes || !isOrdinaryUsage(region.id, type),
  );

  return (
    <>
      {usageTypes.map((type) => {
        const key = usageTypeLayerPref(type);
        return (
          <ToggleSwitch
            key={type}
            label={regionUsagePluralLabel(region.id, type)}
            checked={prefs[key]}
            onChange={() => prefs.toggle(key)}
            compact={compact}
          />
        );
      })}
      {region.hasScenicHighlight && (
        <ToggleSwitch
          label="Scenic lines"
          checked={prefs.showScenicLines}
          onChange={() => prefs.toggle("showScenicLines")}
          compact={compact}
        />
      )}
    </>
  );
}
