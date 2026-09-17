"use client";

import ToggleSwitch from "@/components/ui/ToggleSwitch";
import type { LayerPrefs } from "@/lib/map/layerPrefs";
import { type Region, regionUsagePluralLabel } from "@/lib/regions";

/**
 * The user map's three layer switches, in whichever container asks for them: the
 * hamburger menu, or the shared map's progress box (`compact`), that being the one
 * map with no menu of its own.
 *
 * One component rather than two copies, because the region rules live here — the
 * usage types are named as the region names them (`regionUsagePluralLabel`, which
 * is how Japan's Special switch reads "Non-JR lines"), and not every region offers
 * the scenic outline (`Region.hasScenicHighlight`) — and a menu that offered a
 * toggle the map ignores would be worse than no menu.
 */

interface LayerTogglesProps {
  prefs: LayerPrefs & { toggle: (key: keyof LayerPrefs) => void };
  region: Region;
  compact?: boolean;
}

export default function LayerToggles({ prefs, region, compact = false }: LayerTogglesProps) {
  return (
    <>
      <ToggleSwitch
        label={regionUsagePluralLabel(region.id, 1)}
        checked={prefs.showHeritage}
        onChange={() => prefs.toggle("showHeritage")}
        compact={compact}
      />
      <ToggleSwitch
        label={regionUsagePluralLabel(region.id, 2)}
        checked={prefs.showSpecial}
        onChange={() => prefs.toggle("showSpecial")}
        compact={compact}
      />
      {region.hasScenicHighlight && (
        <ToggleSwitch
          label="Scenic lines"
          checked={prefs.showScenicOutline}
          onChange={() => prefs.toggle("showScenicOutline")}
          compact={compact}
        />
      )}
    </>
  );
}
