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
import { type ReactNode, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import * as api from "@/api/endpoints";
import { useAuth } from "@/auth/AuthContext";
import { useLogVersion } from "@/logbook/logVersion";
import { SelectionBar } from "@/logbook/SelectionBar";
import { MapProgressBox } from "@/map/MapProgressBox";
import { RailwayMap } from "@/map/RailwayMap";
import { useRegion } from "@/region/RegionContext";
import { useEffectiveCountries } from "@/region/useEffectiveCountries";
import { Button } from "@/ui/Button";

export default function MapScreen(): ReactNode {
  const { user } = useAuth();
  const { regionId } = useRegion();
  const { countries, loadError, retry } = useEffectiveCountries();
  const logVersion = useLogVersion();
  const [progress, setProgress] = useState<api.Progress | null>(null);

  // The previous region's numbers must not sit over the new region's map. Only a
  // change of what is counted clears them: a refresh (a new log version) keeps them
  // until the new ones arrive, and keeps them if those never do.
  // biome-ignore lint/correctness/useExhaustiveDependencies: regionId and countries are the triggers — a change of either is what makes the numbers on screen wrong.
  useEffect(() => {
    setProgress(null);
  }, [regionId, countries]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: logVersion is an intentional trigger — bumping it is what re-reads the numbers after a journey is logged.
  useEffect(() => {
    if (!countries) return;
    // Nor may they arrive late and replace the new region's: an answer for inputs
    // that have since changed is dropped.
    let cancelled = false;
    api
      .progress(regionId, countries)
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
  }, [countries, regionId, logVersion]);

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
          flex sibling rather than something covering the progress box. */}
      <View className="flex-1">
        <RailwayMap countries={countries} />
        <MapProgressBox progress={progress} />
      </View>
      <SelectionBar />
    </View>
  );
}
