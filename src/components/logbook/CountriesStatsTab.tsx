"use client";

import type { ReactNode } from "react";
import { useAsyncLoad } from "@/hooks/useAsyncLoad";
import type { DataAccess } from "@/lib/dataAccess";
import { useLayerPrefs } from "@/lib/map/layerPrefsContext";
import { useRegion } from "@/lib/regionContext";
import { getCountryFlag } from "@/lib/shared/countryFlag";
import { usageTypeLayerPref } from "@/lib/shared/map/layerPrefs";
import { hasOrdinaryNonRegular, regionUsagePluralLabel } from "@/lib/shared/regions";
import { btn } from "@/lib/ui/buttonStyles";
import { FORM_ERROR } from "@/lib/ui/inputStyles";

interface CountriesStatsTabProps {
  dataAccess: DataAccess;
  selectedCountries: string[];
  onCountryChange: (countries: string[]) => void;
}

const formatKm = (km: number) =>
  km.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const percent = (completedKm: number, totalKm: number) =>
  totalKm > 0 ? `${((completedKm / totalKm) * 100).toFixed(1)}%` : null;

/**
 * The sidebar's statistics tab, in two parts a region may have either or both of:
 * the countries — the map's filter, each with its km — where the region has more
 * than one (`hasCountryFilter`), and the split by line type where the region counts
 * more than Regular (`ordinaryUsageTypes` — Japan's JR and non-JR lines), ticked
 * the same way. Europe shows the first, Japan the second, both end on the total.
 */
export default function CountriesStatsTab({
  dataAccess,
  selectedCountries,
  onCountryChange,
}: CountriesStatsTabProps) {
  // Only this region's countries and line types - the other region is a separate
  // view entirely.
  const region = useRegion();
  const countries = region.countries;
  const showCountries = region.hasCountryFilter;
  const showUsage = hasOrdinaryNonRegular(region.id);
  // The line types are ticked through the map's layer switches, which also hide
  // them on the map and take them out of the progress box
  const layerPrefs = useLayerPrefs();
  // The numbers don't depend on the selection - every country in the region is
  // counted, ticked or not - so toggling one must not reload them. The tab is
  // mounted only while open, so opening it is what picks up newly logged rides;
  // `dataAccess` changes on login/logout and region switch.
  const {
    data: stats,
    loading: isLoading,
    error: loadError,
    retry,
  } = useAsyncLoad(() => dataAccess.getProgressByCountry(), [dataAccess], "statistics");
  const loadFailed = loadError !== null;

  const handleCountryToggle = (countryCode: string) => {
    const newSelection = selectedCountries.includes(countryCode)
      ? selectedCountries.filter((c) => c !== countryCode)
      : [...selectedCountries, countryCode];
    onCountryChange(newSelection);
  };

  const handleSelectAll = () => {
    onCountryChange(countries.map((c) => c.code));
  };

  const handleSelectNone = () => {
    onCountryChange([]);
  };

  return (
    <div className="p-4 text-fg">
      <h3 className="text-lg font-bold mb-4">
        {showCountries ? "Countries & Statistics" : "Statistics"}
      </h3>

      {showCountries && (
        <>
          {/* Quick Actions */}
          <div className="flex gap-2 mb-4">
            <button type="button" onClick={handleSelectAll} className={`${btn("primary")} flex-1`}>
              Select All
            </button>
            <button type="button" onClick={handleSelectNone} className={`${btn("subtle")} flex-1`}>
              Select None
            </button>
          </div>

          {/* Selection Status */}
          <div className="text-sm text-gray-600 mb-4">
            {selectedCountries.length === 0 && (
              <div className="text-orange-600 font-medium">⚠️ No countries selected</div>
            )}
            {selectedCountries.length > 0 && (
              <div>
                {selectedCountries.length} of {countries.length} countries selected
              </div>
            )}
          </div>
        </>
      )}

      {/* A failed load must not read as "nothing ridden", so the numbers are
          blanked rather than zeroed - but the rows stay selectable, since the
          filter works without them */}
      {loadFailed && (
        <div className={`${FORM_ERROR} mb-4 flex items-center justify-between gap-3`} role="alert">
          <span>Couldn't load the statistics.</span>
          <button type="button" onClick={retry} className={btn("outline")}>
            Retry
          </button>
        </div>
      )}

      {isLoading && (
        <div className="text-sm text-gray-500 py-4 text-center">Loading statistics...</div>
      )}

      {/* Country Checkboxes with Stats */}
      {showCountries && (
        <div className="space-y-2 mb-6">
          {countries.map((country) => {
            const countryStat = stats?.byCountry.find((s) => s.countryCode === country.code);
            return (
              <FilterRow
                key={country.code}
                checked={selectedCountries.includes(country.code)}
                onToggle={() => handleCountryToggle(country.code)}
                label={
                  <>
                    <span className="text-2xl" title={country.code}>
                      {getCountryFlag(country.code)}
                    </span>
                    <span className="text-sm text-gray-600">{country.name}</span>
                  </>
                }
                numbers={
                  !stats || loadFailed
                    ? null
                    : `${formatKm(countryStat?.completedKm ?? 0)} / ${formatKm(countryStat?.totalKm ?? 0)} km`
                }
              />
            );
          })}
        </div>
      )}

      {/* By line type: counted separately, then the total below. Each is ticked
          like a country: unticked, it is hidden on the map and left out of the
          progress box (the layer switch it stands for - `usageTypeLayerPref`). */}
      {showUsage && (
        <>
          {region.ordinaryUsageTypes.every((type) => !layerPrefs[usageTypeLayerPref(type)]) && (
            <div className="text-sm text-orange-600 font-medium mb-4">⚠️ No line types selected</div>
          )}
          <div className="space-y-2 mb-6">
            {region.ordinaryUsageTypes.map((usageType) => {
              const usage = loadFailed
                ? undefined
                : stats?.byUsage.find((u) => u.usageType === usageType);
              const share = usage ? percent(usage.completedKm, usage.totalKm) : null;
              const prefKey = usageTypeLayerPref(usageType);
              return (
                <FilterRow
                  key={usageType}
                  checked={layerPrefs[prefKey]}
                  onToggle={() => layerPrefs.toggle(prefKey)}
                  label={
                    <span className="text-sm font-medium text-gray-700">
                      {regionUsagePluralLabel(region.id, usageType)}
                    </span>
                  }
                  numbers={
                    usage ? (
                      <>
                        {formatKm(usage.completedKm)} / {formatKm(usage.totalKm)} km
                        {share && <span className="ml-2 text-gray-500">{share}</span>}
                      </>
                    ) : null
                  }
                />
              );
            })}
          </div>
        </>
      )}

      {/* Total Stats */}
      {!isLoading && stats && (
        <div className="border-t pt-4">
          <h4 className="font-bold text-gray-700 mb-2">
            {showCountries ? "Countries Total" : "Total"}
          </h4>
          <div className="text-lg">
            <span className="font-semibold text-green-600">
              {formatKm(stats.total.completedKm)}
            </span>
            {" / "}
            <span className="font-semibold">{formatKm(stats.total.totalKm)}</span>
            {" km"}
          </div>
          {stats.total.totalKm > 0 && (
            <div className="text-sm text-gray-600 mt-1">
              {percent(stats.total.completedKm, stats.total.totalKm)} completed
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One ticked row of the tab — a country, or a line type — with its numbers. The
 * rows are the filter, and stay while the numbers load or fail to (shown as "—"):
 * the filter works without them.
 */
function FilterRow({
  checked,
  onToggle,
  label,
  numbers,
}: {
  checked: boolean;
  onToggle: () => void;
  label: ReactNode;
  /** Null while there is nothing to show. */
  numbers: ReactNode;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-3 p-2 rounded hover:bg-gray-50 ${
        checked ? "bg-blue-50" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={checked} onChange={onToggle} className="w-4 h-4" />
        {label}
      </div>
      <div className="text-sm text-gray-600 text-right">{numbers ?? "—"}</div>
    </label>
  );
}
