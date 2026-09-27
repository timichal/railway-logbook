"use client";

import { useAsyncLoad } from "@/hooks/useAsyncLoad";
import type { DataAccess } from "@/lib/dataAccess";
import { useRegion } from "@/lib/regionContext";
import { getCountryFlag } from "@/lib/shared/countryFlag";
import { btn } from "@/lib/ui/buttonStyles";
import { FORM_ERROR } from "@/lib/ui/inputStyles";

interface CountriesStatsTabProps {
  dataAccess: DataAccess;
  selectedCountries: string[];
  onCountryChange: (countries: string[]) => void;
}

export default function CountriesStatsTab({
  dataAccess,
  selectedCountries,
  onCountryChange,
}: CountriesStatsTabProps) {
  // The tab only exists for a region with more than one country, and lists that
  // region's countries alone - the other region is a separate view entirely.
  const countries = useRegion().countries;
  // The per-country numbers don't depend on the selection - every country in the
  // region is counted, ticked or not - so toggling one must not reload them. The
  // tab is mounted only while open, so opening it is what picks up newly logged
  // rides; `dataAccess` changes on login/logout and region switch.
  const {
    data: stats,
    loading: isLoading,
    error: loadError,
    retry,
  } = useAsyncLoad(() => dataAccess.getProgressByCountry(), [dataAccess], "country stats");
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

  const formatKm = (km: number) => {
    return km.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  };

  return (
    <div className="p-4 text-fg">
      <h3 className="text-lg font-bold mb-4">Countries & Statistics</h3>

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

      {/* A failed load must not read as "nothing ridden", so the numbers are
          blanked rather than zeroed - but the countries stay selectable, since
          the filter works without them */}
      {loadFailed && (
        <div className={`${FORM_ERROR} mb-4 flex items-center justify-between gap-3`} role="alert">
          <span>Couldn't load the statistics.</span>
          <button type="button" onClick={retry} className={btn("outline")}>
            Retry
          </button>
        </div>
      )}

      {/* Country Checkboxes with Stats */}
      <div className="space-y-2 mb-6">
        {isLoading ? (
          <div className="text-sm text-gray-500 py-4 text-center">Loading statistics...</div>
        ) : (
          countries.map((country) => {
            const countryStat = stats?.byCountry.find((s) => s.countryCode === country.code);
            const isSelected = selectedCountries.includes(country.code);

            return (
              <label
                key={country.code}
                className={`flex items-center justify-between p-2 rounded hover:bg-gray-50 ${
                  isSelected ? "bg-blue-50" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleCountryToggle(country.code)}
                    className="w-4 h-4"
                  />
                  <span className="text-2xl" title={country.code}>
                    {getCountryFlag(country.code)}
                  </span>
                  <span className="text-sm text-gray-600">{country.name}</span>
                </div>
                <div className="text-sm text-gray-600">
                  {loadFailed ? (
                    "—"
                  ) : countryStat ? (
                    <>
                      {formatKm(countryStat.completedKm)} / {formatKm(countryStat.totalKm)} km
                    </>
                  ) : (
                    "0.0 / 0.0 km"
                  )}
                </div>
              </label>
            );
          })
        )}
      </div>

      {/* Total Stats */}
      {!isLoading && stats && (
        <div className="border-t pt-4">
          <h4 className="font-bold text-gray-700 mb-2">Countries Total</h4>
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
              {((stats.total.completedKm / stats.total.totalKm) * 100).toFixed(1)}% completed
            </div>
          )}
        </div>
      )}
    </div>
  );
}
