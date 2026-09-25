/**
 * The map tab: the map, filling the screen, with the region's numbers over one corner.
 *
 * `RailwayMap` needs one thing from outside itself: which countries to draw at all.
 * Whose visit colours to draw is not a prop — the route tile is served per bearer
 * token (`map/tileAuth.ts`), so the signed-in user is simply whoever the request
 * says. The country list is `useEffectiveCountries`
 * — the stored preference where the region allows a filter, the region's own list
 * where it does not — and until it arrives there is nothing to draw, since a tile
 * requested without it would answer for every country and then be replaced.
 *
 * The safe-area inset is deliberately not applied to the map: a map should run under
 * the status bar. The progress box is positioned inside `RailwayMap` against the map's
 * own bottom edge, which the tab bar already keeps clear.
 */
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import * as api from "@/api/endpoints";
import { useAuth } from "@/auth/AuthContext";
import { useLogVersion } from "@/logbook/logVersion";
import { SelectionBar } from "@/logbook/SelectionBar";
import { HighlightChip } from "@/map/HighlightChip";
import { MapProgressBox } from "@/map/MapProgressBox";
import { PlannerButton } from "@/map/PlannerButton";
import { RailwayMap } from "@/map/RailwayMap";
import { useRegion } from "@/region/RegionContext";
import { useEffectiveCountries } from "@/region/useEffectiveCountries";

export default function MapScreen(): ReactNode {
  const { user } = useAuth();
  const { regionId } = useRegion();
  const { countries, error: countriesError } = useEffectiveCountries();
  const logVersion = useLogVersion();
  const [progress, setProgress] = useState<api.Progress | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: logVersion is an intentional trigger — bumping it is what re-reads the numbers after a journey is logged.
  const load = useCallback(async (): Promise<void> => {
    if (!countries) return;
    try {
      setProgress(await api.progress(regionId, countries));
    } catch {
      // The numbers are the smaller half of this screen; a map with no percentage
      // over it is still the map. The error is not worth covering it with.
      setProgress(null);
    }
  }, [countries, regionId, logVersion]);

  useEffect(() => {
    // The previous region's numbers must not sit over the new region's map.
    setProgress(null);
    void load();
  }, [load]);

  if (countriesError) {
    return (
      <View className="flex-1 items-center justify-center bg-white p-6 dark:bg-gray-900">
        <Text className="text-center text-sm text-red-600 dark:text-red-400">{countriesError}</Text>
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
          flex sibling rather than something covering the progress box. */}
      <View className="flex-1">
        <RailwayMap countries={countries} />
        <MapProgressBox progress={progress} />
        <HighlightChip />
        <PlannerButton />
      </View>
      <SelectionBar />
    </View>
  );
}
