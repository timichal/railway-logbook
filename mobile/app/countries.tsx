/**
 * Countries & statistics — the web app's `CountriesStatsTab`, as a screen of its own.
 *
 * Two things in one list, as on the web, because they are one decision: which
 * countries the map and the numbers cover, and how much of each one has been ridden.
 * Ticking a country is what the map filters on; the km beside it is why you would.
 *
 * **Only a region that has a filter has this screen** (`hasCountryFilter`): Japan is
 * one country, its filter is pinned to itself, and there would be nothing to tick.
 * Settings hides the row, and a region switch while this is open sends it back.
 *
 * Pushed rather than modal: it is a settings page, and it is left by going back
 * rather than by being spent.
 *
 * The stats are **not** filtered by the selection — the selection is made from them,
 * and a country ticked off would otherwise lose the number that says whether to tick
 * it back on. They are reloaded when the log changes, since riding something is what
 * moves them.
 */
import { getCountryFlag } from "@shared/countryFlag";
import { useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import * as api from "@/api/endpoints";
import { useLogVersion } from "@/logbook/logVersion";
import { useCountryPrefs } from "@/region/CountryPrefsContext";
import { useRegion } from "@/region/RegionContext";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";

export default function CountriesScreen(): ReactNode {
  const router = useRouter();
  const { region, regionId } = useRegion();
  const { selectedCountries, error, setSelectedCountries } = useCountryPrefs();
  const logVersion = useLogVersion();
  const [stats, setStats] = useState<api.ProgressByCountry | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: logVersion is an intentional trigger — riding something is what changes these numbers.
  const load = useCallback(async (): Promise<void> => {
    try {
      setStats(await api.progressByCountry(regionId));
    } catch {
      // The list is still usable as a filter without its numbers, which is the half
      // that writes anything.
      setStats(null);
    }
  }, [regionId, logVersion]);

  useEffect(() => {
    void load();
  }, [load]);

  // A region with one country has nothing to tick; it also has no way to have got
  // here except by switching region with this screen open.
  useEffect(() => {
    if (!region.hasCountryFilter) router.back();
  }, [region.hasCountryFilter, router]);

  const selected = selectedCountries ?? [];
  const toggle = (code: string): void => {
    setSelectedCountries(
      selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code],
    );
  };

  return (
    <Screen edges={["top"]}>
      <View className="flex-row items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
        <Text className="text-lg font-bold text-gray-900 dark:text-gray-100">
          Countries & statistics
        </Text>
      </View>

      <ScrollView contentContainerClassName="gap-4 p-4">
        <View className="flex-row gap-2">
          <Button
            label="Select all"
            className="flex-1"
            onPress={() => setSelectedCountries(region.countries.map((c) => c.code))}
          />
          <Button
            label="Select none"
            variant="secondary"
            className="flex-1"
            onPress={() => setSelectedCountries([])}
          />
        </View>

        {error ? (
          <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text>
        ) : selectedCountries === null ? (
          <ActivityIndicator />
        ) : selected.length === 0 ? (
          <Text className="text-sm font-medium text-amber-700 dark:text-amber-400">
            No countries selected — the map is drawing nothing.
          </Text>
        ) : (
          <Text className="text-sm text-gray-600 dark:text-gray-400">
            {selected.length} of {region.countries.length} countries selected
          </Text>
        )}

        <View className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
          {region.countries.map((country, index) => (
            <CountryRow
              key={country.code}
              code={country.code}
              name={country.name}
              stat={stats?.byCountry.find((s) => s.countryCode === country.code)}
              selected={selected.includes(country.code)}
              first={index === 0}
              onToggle={() => toggle(country.code)}
            />
          ))}
        </View>

        {stats ? <Total total={stats.total} /> : null}
      </ScrollView>
    </Screen>
  );
}

function CountryRow({
  code,
  name,
  stat,
  selected,
  first,
  onToggle,
}: {
  code: string;
  name: string;
  stat: api.CountryProgress | undefined;
  selected: boolean;
  first: boolean;
  onToggle(): void;
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={name}
      onPress={onToggle}
      className={`min-h-14 flex-row items-center gap-3 px-3 py-2 active:opacity-70 ${
        selected ? "bg-blue-50 dark:bg-blue-950" : "bg-white dark:bg-gray-800"
      } ${first ? "" : "border-t border-gray-200 dark:border-gray-700"}`}
    >
      {/* A box drawn rather than a native checkbox: React Native has none that both
          platforms share, and the row is the hit area anyway. */}
      <View
        className={`h-5 w-5 items-center justify-center rounded border ${
          selected ? "border-blue-600 bg-blue-600" : "border-gray-400 dark:border-gray-500"
        }`}
      >
        {selected ? <Text className="text-xs font-bold text-white">✓</Text> : null}
      </View>
      <Text className="text-2xl">{getCountryFlag(code)}</Text>
      <Text className="flex-1 text-sm text-gray-900 dark:text-gray-100">{name}</Text>
      <Text className="text-sm text-gray-600 dark:text-gray-400">
        {formatKm(stat?.completedKm ?? 0)} / {formatKm(stat?.totalKm ?? 0)} km
      </Text>
    </Pressable>
  );
}

function Total({ total }: { total: api.ProgressByCountry["total"] }): ReactNode {
  return (
    <View className="gap-1 border-t border-gray-200 pt-4 dark:border-gray-700">
      <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        Countries total
      </Text>
      <Text className="text-lg text-gray-900 dark:text-gray-100">
        <Text className="font-semibold text-green-600 dark:text-green-400">
          {formatKm(total.completedKm)}
        </Text>
        {" / "}
        <Text className="font-semibold">{formatKm(total.totalKm)}</Text> km
      </Text>
      {total.totalKm > 0 ? (
        <Text className="text-sm text-gray-600 dark:text-gray-400">
          {((total.completedKm / total.totalKm) * 100).toFixed(1)}% completed
        </Text>
      ) : null}
    </View>
  );
}

function formatKm(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
