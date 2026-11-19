/**
 * The map's layer switches, as `LayerToggles` is on the web — same labels, same
 * region rules, in the Settings tab rather than in the web sidebar's Map & Stats tab
 * (this app's Countries/Statistics screen is a separate screen reached from
 * Settings).
 *
 * The region rules live here rather than in the map, for the same reason they do
 * there: a switch the map ignores would be worse than no switch. The usage types are
 * the ones the region has a switch for (`switchableUsageTypes`), named as it names
 * them (`regionUsagePluralLabel`), and not every region offers the scenic lines
 * (`Region.hasScenicHighlight`).
 *
 * **A usage type the region counts as ordinary service is not switched here** but
 * ticked on the Statistics screen beside its numbers (Japan's JR and non-JR lines),
 * as Europe's countries are — so in Japan the switches carry Heritage alone.
 */
import { switchableUsageTypes, usageTypeLayerPref } from "@shared/map/layerPrefs";
import { isOrdinaryUsage, regionUsagePluralLabel } from "@shared/regions";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useLayerPrefs } from "@/map/LayerPrefsContext";
import { useRegion } from "@/region/RegionContext";
import { ToggleSwitch } from "@/ui/ToggleSwitch";

export function LayerToggles(): ReactNode {
  const { region } = useRegion();
  const prefs = useLayerPrefs();
  const usageTypes = switchableUsageTypes(region.id).filter(
    (type) => !isOrdinaryUsage(region.id, type),
  );

  return (
    <View className="gap-1">
      {usageTypes.map((type) => {
        const key = usageTypeLayerPref(type);
        return (
          <ToggleSwitch
            key={type}
            label={regionUsagePluralLabel(region.id, type)}
            value={prefs[key]}
            onChange={(value) => prefs.setPref(key, value)}
          />
        );
      })}
      {/* The closed lines ridden are drawn whatever this says (closedRoutesFilter) */}
      <ToggleSwitch
        label="All closed lines"
        value={prefs.showClosed}
        onChange={(value) => prefs.setPref("showClosed", value)}
      />
      {region.hasScenicHighlight ? (
        <ToggleSwitch
          label="Scenic lines"
          value={prefs.showScenicLines}
          onChange={(value) => prefs.setPref("showScenicLines", value)}
        />
      ) : null}
    </View>
  );
}
