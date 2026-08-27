/**
 * Where the map goes in Phase 3. Until then it is the proof that the shell works
 * end to end: the region is the one the switch chose, and the numbers come from
 * `GET /progress?region=` with the bearer token attached — the same query the web
 * app's progress box runs, filtered by the same country list.
 */
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import * as api from "@/api/endpoints";
import { useRegion } from "@/region/RegionContext";
import { useEffectiveCountries } from "@/region/useEffectiveCountries";
import { Screen } from "@/ui/Screen";

export default function MapScreen(): ReactNode {
  const { region, regionId } = useRegion();
  const { countries, error: countriesError } = useEffectiveCountries();
  const [progress, setProgress] = useState<api.Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!countries) return;

    setError(null);
    try {
      setProgress(await api.progress(regionId, countries));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load your progress.");
    }
  }, [countries, regionId]);

  useEffect(() => {
    // The previous region's numbers must not sit under the new region's heading.
    setProgress(null);
    void load();
  }, [load]);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <Screen edges={["top"]}>
      <ScrollView
        contentContainerClassName="gap-6 p-6"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <View className="gap-1">
          <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {region.flag} {region.label}
          </Text>
          <Text className="text-sm text-gray-600 dark:text-gray-400">
            The map arrives in Phase 3. These are your numbers for this region.
          </Text>
        </View>

        {(error ?? countriesError) ? (
          <Text className="text-sm text-red-600 dark:text-red-400">{error ?? countriesError}</Text>
        ) : progress ? (
          <View className="gap-3 rounded-2xl bg-gray-100 p-5 dark:bg-gray-800">
            <Stat
              label="Ridden"
              value={`${Math.round(progress.completedKm).toLocaleString()} km`}
              detail={`of ${Math.round(progress.totalKm).toLocaleString()} km · ${progress.percentage.toFixed(1)}%`}
            />
            <Stat
              label="Routes"
              value={`${progress.completedRoutes.toLocaleString()}`}
              detail={`of ${progress.totalRoutes.toLocaleString()} · ${progress.routePercentage.toFixed(1)}%`}
            />
          </View>
        ) : (
          <ActivityIndicator />
        )}
      </ScrollView>
    </Screen>
  );
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}): ReactNode {
  return (
    <View className="gap-0.5">
      <Text className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </Text>
      <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</Text>
      <Text className="text-sm text-gray-600 dark:text-gray-400">{detail}</Text>
    </View>
  );
}
