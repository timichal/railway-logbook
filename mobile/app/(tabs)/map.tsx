/**
 * The map tab: the map, filling the screen, with the region's numbers over one corner.
 *
 * `RailwayMap` needs one thing from outside itself: which countries to draw at all.
 * Whose visit colours to draw is not a prop — the rides are read with the bearer
 * token (`map/useRides.ts`), so the signed-in user is simply whoever the request
 * says. The country list is `useEffectiveCountries`
 * — the stored preference where the region allows a filter, the region's own list
 * where it does not — and until it arrives there is nothing to draw, since the route
 * layers' country filter is made from it.
 *
 * The safe-area inset is deliberately not applied to the map: a map should run under
 * the status bar. The progress box is positioned inside `RailwayMap` against the map's
 * own bottom edge, which the tab bar already keeps clear.
 */
import type { UsageType } from "@shared/constants";
import { shownUsageTypes } from "@shared/map/userMapLayers";
import { countedUsageTypes } from "@shared/regions";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import * as api from "@/api/endpoints";
import { useAuth } from "@/auth/AuthContext";
import { useLogVersion } from "@/logbook/logVersion";
import { SelectionBar } from "@/logbook/SelectionBar";
import { useLayerPrefs } from "@/map/LayerPrefsContext";
import { MapProgressBox } from "@/map/MapProgressBox";
import { PlannerButton } from "@/map/PlannerButton";
import { RailwayMap } from "@/map/RailwayMap";
import { useRegion } from "@/region/RegionContext";
import { useEffectiveCountries } from "@/region/useEffectiveCountries";
import { Button } from "@/ui/Button";

export default function MapScreen(): ReactNode {
  const { user } = useAuth();
  const { regionId } = useRegion();
  const { countries, loadError, retry } = useEffectiveCountries();
  const logVersion = useLogVersion();
  const counted = useCountedUsageTypes();
  const [progress, setProgress] = useState<api.Progress | null>(null);

  // The previous region's numbers must not sit over the new region's map. Only a
  // change of what is counted clears them: a refresh (a new log version) keeps them
  // until the new ones arrive, and keeps them if those never do.
  // biome-ignore lint/correctness/useExhaustiveDependencies: regionId, countries and counted are the triggers — a change of any is what makes the numbers on screen wrong.
  useEffect(() => {
    setProgress(null);
  }, [regionId, countries, counted]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: logVersion is an intentional trigger — bumping it is what re-reads the numbers after a journey is logged.
  useEffect(() => {
    if (!countries || !counted) return;
    // Nor may they arrive late and replace the new region's: an answer for inputs
    // that have since changed is dropped.
    let cancelled = false;
    api
      .progress(regionId, countries, counted)
      .then((next) => {
        if (!cancelled) setProgress(next);
      })
      .catch(() => {
        // The numbers are the smaller half of this screen; a map with no percentage
        // over it is still the map. The error is not worth covering it with.
      });
    return () => {
      cancelled = true;
    };
  }, [countries, counted, regionId, logVersion]);

  // Only a list that could not be had at all stops the map — not a failed save,
  // which is undone and reported on the Countries screen.
  if (!countries && loadError) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-white p-6 dark:bg-gray-900">
        <Text className="text-center text-sm text-red-600 dark:text-red-400">{loadError}</Text>
        <Button label="Try again" onPress={retry} />
      </View>
    );
  }

  if (!countries || !user) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-100 dark:bg-gray-900">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1">
      {/* The map and its own furniture in one pane, so the selection bar below is a
          flex sibling rather than something covering the progress box. The box and the
          planner button go inside the map, which draws its sheet and notice over them. */}
      <RailwayMap countries={countries}>
        <MapProgressBox progress={progress} />
        <PlannerButton />
      </RailwayMap>
      <SelectionBar />
    </View>
  );
}

/**
 * The usage types the progress box counts: the region's ordinary ones among those
 * the map shows, as on the web (`useUserMap`), so unticking Japan's non-JR lines in
 * Statistics takes them out of the numbers as unticking a country does. Memoised on
 * the list's content rather than on the switches: Europe counts Regular alone, and
 * its heritage and special switches must not re-read the numbers.
 */
function useCountedUsageTypes(): UsageType[] | null {
  const { regionId } = useRegion();
  const { showRegular, showHeritage, showSpecial, loaded } = useLayerPrefs();
  const key = countedUsageTypes(
    regionId,
    shownUsageTypes({ showRegular, showHeritage, showSpecial }),
  ).join(",");
  return useMemo(() => {
    // Not until the stored switches are read: the defaults first would ask twice,
    // and clear the box in between, for anyone who has unticked a line type
    if (!loaded) return null;
    return key === "" ? [] : (key.split(",").map(Number) as UsageType[]);
  }, [key, loaded]);
}
