"use client";

import type { ReactNode } from "react";
import LayerToggles from "@/components/map/LayerToggles";
import { useAsyncLoad } from "@/hooks/useAsyncLoad";
import type { DataAccess } from "@/lib/dataAccess";
import { useLayerPrefs } from "@/lib/map/layerPrefsContext";
import { useRegion } from "@/lib/regionContext";
import { getCountryFlag } from "@/lib/shared/countryFlag";
import { usageTypeLayerPref } from "@/lib/shared/map/layerPrefs";
import { hasOrdinaryNonRegular, hasStatsView, regionUsagePluralLabel } from "@/lib/shared/regions";
import { btn } from "@/lib/ui/buttonStyles";
import { FORM_ERROR } from "@/lib/ui/inputStyles";

interface MapStatsTabProps {
  dataAccess: DataAccess;
  selectedCountries: string[];
  onCountryChange: (countries: string[]) => void;
}

const formatKm = (km: number) =>
  km.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const percent = (completedKm: number, totalKm: number) =>
  totalKm > 0 ? `${((completedKm / totalKm) * 100).toFixed(1)}%` : null;

/**
 * The sidebar's Map & Stats tab: everything that decides what the map draws, beside
 * the numbers it counts. It used to be the statistics alone, with the layer switches
 * in the hamburger menu — but a switch is used while looking at the map, and the
 * menu covers the map (the whole screen on a phone, a dimmed page on desktop), so
 * every flip was made blind. Here the map stays in view beside the sidebar, or above
 * the half-raised sheet. And in Japan, where JR and non-JR lines were already ticked
 * in this tab, Heritage was switched in the menu: two places for one kind of choice.
 *
 * Two groups, split by **what is counted**, which is also why they are two kinds of
 * control:
 * - "Show on map" — switches for the lines that are drawn but never counted
 *   (Heritage, Europe's Special services) and, where the region has it, the scenic
 *   highlight — which is no line of its own, only a band over routes already counted,
 *   so the hint says so rather than lumping it in. Short, so it goes first, where
 *   Europe's long country list can't bury it (`LayerToggles`).
 * - the counted rows (`CountedStats`), ticked like checkboxes beside their km: the
 *   countries where the region has more than one (`hasCountryFilter`), and the split
 *   by line type where it counts more than Regular (`ordinaryUsageTypes` — Japan's JR
 *   and non-JR lines). Unticked is hidden on the map *and* left out of the numbers.
 *   Absent where the region has neither (`hasStatsView`).
 */
export default function MapStatsTab({
  dataAccess,
  selectedCountries,
  onCountryChange,
}: MapStatsTabProps) {
  const region = useRegion();
  const layerPrefs = useLayerPrefs();

  return (
    <div className="p-4 text-fg space-y-6">
      <section>
        <SectionHeading
          title="Show on map"
          hint={`These lines aren't counted in your progress.${
            region.hasScenicHighlight
              ? " Scenic lines only highlight routes already on the map."
              : ""
          }`}
        />
        <LayerToggles prefs={layerPrefs} region={region} />
      </section>

      {hasStatsView(region.id) && (
        <CountedStats
          dataAccess={dataAccess}
          selectedCountries={selectedCountries}
          onCountryChange={onCountryChange}
        />
      )}
    </div>
  );
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">{title}</h3>
      <p className="text-xs text-gray-500 mt-0.5">{hint}</p>
    </div>
  );
}

/** The counted rows and the total; mounted only where there is something to count. */
function CountedStats({ dataAccess, selectedCountries, onCountryChange }: MapStatsTabProps) {
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
    <section>
      <SectionHeading
        title={showCountries ? "Countries" : "Line types"}
        hint={`Ticked ${showCountries ? "countries" : "line types"} are shown and counted.`}
      />

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
            const completedKm = countryStat?.completedKm ?? 0;
            const totalKm = countryStat?.totalKm ?? 0;
            const share = percent(completedKm, totalKm);
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
                  !stats || loadFailed ? null : (
                    <>
                      {formatKm(completedKm)} / {formatKm(totalKm)} km
                      {share && <span className="ml-2 text-gray-500">{share}</span>}
                    </>
                  )
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
    </section>
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
