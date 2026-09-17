/**
 * The three layer switches, as `LayerToggles` is on the web — same labels, same
 * region rules, in the Settings tab instead of the hamburger menu (which is what the
 * Settings tab is here).
 *
 * The region rules live here rather than in the map, for the same reason they do
 * there: a switch the map ignores would be worse than no switch. Japan renames
 * Special to "Non-JR lines" and offers no scenic outline at all
 * (`Region.hasScenicHighlight`).
 */
import type { ReactNode } from "react";
import { View } from "react-native";
import { useLayerPrefs } from "@/map/LayerPrefsContext";
import { useRegion } from "@/region/RegionContext";
import { ToggleSwitch } from "@/ui/ToggleSwitch";

export function LayerToggles(): ReactNode {
  const { region } = useRegion();
  const { showHeritage, showSpecial, showScenicOutline, setPref } = useLayerPrefs();

  return (
    <View className="gap-1">
      <ToggleSwitch
        label="Heritage & tourist lines"
        value={showHeritage}
        onChange={(value) => setPref("showHeritage", value)}
      />
      <ToggleSwitch
        label={region.id === "japan" ? "Non-JR lines" : "Special services"}
        value={showSpecial}
        onChange={(value) => setPref("showSpecial", value)}
      />
      {region.hasScenicHighlight ? (
        <ToggleSwitch
          label="Scenic lines"
          value={showScenicOutline}
          onChange={(value) => setPref("showScenicOutline", value)}
        />
      ) : null}
    </View>
  );
}
