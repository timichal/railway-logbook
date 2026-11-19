/**
 * Countries & statistics — the counted half of the web app's `MapStatsTab`, as a screen of its own.
 *
 * Where the region has a country filter (`hasCountryFilter`), two things in one list,
 * as on the web, because they are one decision: which countries the map and the
 * numbers cover, and how much of each one has been ridden. Ticking a country is what
 * the map filters on; the km beside it is why you would.
 *
 * Where it counts more than Regular (`ordinaryUsageTypes`), the numbers by line type:
 * Japan is one country, its filter pinned to itself, but its JR and non-JR lines are
 * counted separately and then together — so there the screen is "Statistics" and
 * holds just that. Each line type is ticked as a country is: unticked, it is hidden
 * on the map and left out of the progress box. The tick is that type's layer switch
 * (`usageTypeLayerPref`), which is why Settings' map layers don't repeat it. A region
 * with neither has no screen: Settings hides the row, and a region switch while this
 * is open sends it back.
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
import { usageTypeLayerPref } from "@shared/map/layerPrefs";
import {
  hasOrdinaryNonRegular,
  hasStatsView,
  type RegionId,
  regionUsagePluralLabel,
} from "@shared/regions";
import { useRouter } from "expo-router";
import { type ReactNode, useEffect, useReducer, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import * as api from "@/api/endpoints";
import { useLogVersion } from "@/logbook/logVersion";
import { useLayerPrefs } from "@/map/LayerPrefsContext";
import { useCountryPrefs } from "@/region/CountryPrefsContext";
import { useRegion } from "@/region/RegionContext";
import { Button } from "@/ui/Button";
import { formatKm, formatPercent, percentOf } from "@/ui/format";
import { Screen } from "@/ui/Screen";

export default function CountriesScreen(): ReactNode {
  const router = useRouter();
  const { region, regionId } = useRegion();
  const logVersion = useLogVersion();
  // Tagged with the region they were asked for: the screen stays open across a
  // region switch now that both regions have it, and the other region's numbers
  // must never be shown under this one's labels while its own are on the way
  const [answer, setAnswer] = useState<{
    region: RegionId;
    stats: api.ProgressByCountry | null;
  } | null>(null);
  const [attempt, retry] = useReducer((n: number) => n + 1, 0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: logVersion and attempt are intentional triggers — riding something is what changes these numbers, and Retry asks again.
  useEffect(() => {
    let cancelled = false;
    api
      .progressByCountry(regionId)
      .then((stats) => {
        if (!cancelled) setAnswer({ region: regionId, stats });
      })
      .catch(() => {
        // A failed load reads as "couldn't load", never as zeros. The country list
        // is still usable as a filter without its numbers. A failed *refresh* keeps
        // the numbers this region already has.
        if (cancelled) return;
        setAnswer((previous) =>
          previous?.region === regionId && previous.stats
            ? previous
            : { region: regionId, stats: null },
        );
      });
    // A request for the region just left is dropped, however late it lands
    return () => {
      cancelled = true;
    };
  }, [regionId, logVersion, attempt]);

  const current = answer?.region === regionId ? answer : null;
  const stats = current?.stats ?? null;
  const loadFailed = current !== null && current.stats === null;

  const showCountries = region.hasCountryFilter;

  // A region with nothing to show; it also has no way to have got here except by
  // switching region with this screen open.
  useEffect(() => {
    if (!hasStatsView(regionId)) router.back();
  }, [regionId, router]);

  return (
    <Screen edges={["top"]}>
      <View className="flex-row items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
        <Text className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {showCountries ? "Countries & statistics" : "Statistics"}
        </Text>
      </View>

      <ScrollView contentContainerClassName="gap-4 p-4">
        {showCountries ? <CountryFilter stats={stats} /> : null}
        {/* Only where the line types are counted apart (Japan) */}
        {hasOrdinaryNonRegular(regionId) ? <UsageFilter stats={stats} /> : null}

        {current === null ? (
          <ActivityIndicator />
        ) : loadFailed ? (
          <View className="gap-2 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
            <Text className="text-sm text-red-700 dark:text-red-300">
              Couldn't load the statistics.
            </Text>
            <Button label="Retry" variant="outline" onPress={retry} />
          </View>
        ) : null}

        {stats ? (
          <Total total={stats.total} label={showCountries ? "Countries total" : "Total"} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** The countries to tick, each with its km — the half of the screen that writes. */
function CountryFilter({ stats }: { stats: api.ProgressByCountry | null }): ReactNode {
  const { region } = useRegion();
  const { selectedCountries, loadError, saveError, setSelectedCountries, retry } =
    useCountryPrefs();

  // Until the list is known there is nothing to change: a tap would build a new list
  // from an empty one and save it over the user's real one.
  const ready = selectedCountries !== null;
  const selected = selectedCountries ?? [];
  const toggle = (code: string): void => {
    setSelectedCountries(
      selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code],
    );
  };

  return (
    <>
      <View className="flex-row gap-2">
        <Button
          label="Select all"
          className="flex-1"
          disabled={!ready}
          onPress={() => setSelectedCountries(region.countries.map((c) => c.code))}
        />
        <Button
          label="Select none"
          variant="secondary"
          className="flex-1"
          disabled={!ready}
          onPress={() => setSelectedCountries([])}
        />
      </View>

      {saveError ? (
        <Text className="text-sm text-red-600 dark:text-red-400">{saveError}</Text>
      ) : null}

      {selectedCountries === null && loadError ? (
        <View className="gap-2">
          <Text className="text-sm text-red-600 dark:text-red-400">{loadError}</Text>
          <Button label="Try again" variant="outline" onPress={retry} />
        </View>
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
        {region.countries.map((country, index) => {
          const stat = stats?.byCountry.find((s) => s.countryCode === country.code);
          return (
            <CheckRow
              key={country.code}
              label={country.name}
              leading={<Text className="text-2xl">{getCountryFlag(country.code)}</Text>}
              numbers={
                <Text className="text-sm text-gray-600 dark:text-gray-400">
                  {formatKm(stat?.completedKm ?? 0)} / {formatKm(stat?.totalKm ?? 0)} km
                </Text>
              }
              selected={selected.includes(country.code)}
              first={index === 0}
              disabled={!ready}
              onToggle={() => toggle(country.code)}
            />
          );
        })}
      </View>
    </>
  );
}

/**
 * The line types to tick, each with its km and share. The rows are the filter and
 * stay while the numbers load or fail to, as the country rows do.
 */
function UsageFilter({ stats }: { stats: api.ProgressByCountry | null }): ReactNode {
  const { region } = useRegion();
  const prefs = useLayerPrefs();
  const types = region.ordinaryUsageTypes;

  return (
    <>
      {types.every((type) => !prefs[usageTypeLayerPref(type)]) ? (
        <Text className="text-sm font-medium text-amber-700 dark:text-amber-400">
          No line types selected.
        </Text>
      ) : null}
      <View className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
        {types.map((usageType, index) => {
          const key = usageTypeLayerPref(usageType);
          // `?.`: a server deployed before the field existed sends none
          const stat = stats?.byUsage?.find((u) => u.usageType === usageType);
          return (
            <CheckRow
              key={usageType}
              label={regionUsagePluralLabel(region.id, usageType)}
              numbers={
                stat ? <KmShare completedKm={stat.completedKm} totalKm={stat.totalKm} /> : null
              }
              selected={prefs[key]}
              first={index === 0}
              onToggle={() => prefs.toggle(key)}
            />
          );
        })}
      </View>
    </>
  );
}

/** A row's km, and its share where there is anything to share. */
function KmShare({ completedKm, totalKm }: { completedKm: number; totalKm: number }): ReactNode {
  const share = percentOf(completedKm, totalKm);
  return (
    <View className="items-end">
      <Text className="text-sm text-gray-600 dark:text-gray-400">
        {formatKm(completedKm)} / {formatKm(totalKm)} km
      </Text>
      {share !== null ? (
        <Text className="text-xs text-gray-500 dark:text-gray-400">{formatPercent(share)}</Text>
      ) : null}
    </View>
  );
}

/** One ticked row — a country, or a line type — with its numbers beside it. */
function CheckRow({
  label,
  leading,
  numbers,
  selected,
  first,
  disabled = false,
  onToggle,
}: {
  label: string;
  leading?: ReactNode;
  numbers: ReactNode;
  selected: boolean;
  first: boolean;
  disabled?: boolean;
  onToggle(): void;
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onToggle}
      className={`min-h-14 flex-row items-center gap-3 px-3 py-2 active:opacity-70 ${
        disabled ? "opacity-50" : ""
      } ${
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
      {leading}
      <Text className="flex-1 text-sm text-gray-900 dark:text-gray-100">{label}</Text>
      {numbers}
    </Pressable>
  );
}

function Total({
  total,
  label,
}: {
  total: api.ProgressByCountry["total"];
  label: string;
}): ReactNode {
  const share = percentOf(total.completedKm, total.totalKm);
  return (
    <View className="gap-1 border-t border-gray-200 pt-4 dark:border-gray-700">
      <Text className="text-sm font-semibold text-gray-700 dark:text-gray-300">{label}</Text>
      <Text className="text-lg text-gray-900 dark:text-gray-100">
        <Text className="font-semibold text-green-600 dark:text-green-400">
          {formatKm(total.completedKm)}
        </Text>
        {" / "}
        <Text className="font-semibold">{formatKm(total.totalKm)}</Text> km
      </Text>
      {share !== null ? (
        <Text className="text-sm text-gray-600 dark:text-gray-400">
          {formatPercent(share)} completed
        </Text>
      ) : null}
    </View>
  );
}
