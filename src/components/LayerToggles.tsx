"use client";

import type { LayerPrefs } from "@/lib/map/layerPrefs";
import type { Region } from "@/lib/regions";
import ToggleSwitch from "./ToggleSwitch";

/**
 * The user map's three layer switches, in whichever container asks for them: the
 * map's progress box (`compact`) or the mobile menu.
 *
 * One component rather than two copies, because the region rules live here — Japan
 * renames Special to "Non-JR lines", and not every region offers the scenic outline
 * (`Region.hasScenicHighlight`) — and a menu that offered a toggle the map ignores
 * would be worse than no menu.
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
        label="Heritage & tourist lines"
        checked={prefs.showHeritage}
        onChange={() => prefs.toggle("showHeritage")}
        compact={compact}
      />
      <ToggleSwitch
        label={region.id === "japan" ? "Non-JR lines" : "Special services"}
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
