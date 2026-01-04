'use client';

import { useState, useEffect } from 'react';
import type { DataAccess } from '@/lib/dataAccess';
import { SUPPORTED_COUNTRIES } from '@/lib/constants';
import type { ProgressByCountry } from '@/lib/userActions';

interface CountriesStatsTabProps {
  dataAccess: DataAccess;
  selectedCountries: string[];
  onCountryChange: (countries: string[]) => void;
}

export default function CountriesStatsTab({ dataAccess, selectedCountries, onCountryChange }: CountriesStatsTabProps) {
  const [stats, setStats] = useState<ProgressByCountry | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load stats on mount and when selection changes
  useEffect(() => {
    async function loadStats() {
      setIsLoading(true);
      try {
        const progressData = await dataAccess.getProgressByCountry();
        setStats(progressData);
      } catch (error) {
        console.error('Failed to load country stats:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadStats();
  }, [selectedCountries, dataAccess]); // Reload when selection changes (in case user logs routes)

  const handleCountryToggle = (countryCode: string) => {
    const newSelection = selectedCountries.includes(countryCode)
      ? selectedCountries.filter(c => c !== countryCode)
      : [...selectedCountries, countryCode];
    onCountryChange(newSelection);
  };

  const handleSelectAll = () => {
    onCountryChange(SUPPORTED_COUNTRIES.map(c => c.code));
  };

  const handleSelectNone = () => {
    onCountryChange([]);
  };

  const formatKm = (km: number) => {
    return km.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  };

  // Convert country code to flag emoji (e.g., "CZ" → "🇨🇿")
  const getCountryFlag = (countryCode: string) => {
    return countryCode
      .toUpperCase()
      .replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt(0)));
  };

  return (
    <div className="p-4 text-black">
      <h3 className="text-lg font-bold mb-4">Countries & Statistics</h3>

      {/* Quick Actions */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={handleSelectAll}
          className="flex-1 px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Select All
        </button>
        <button
          onClick={handleSelectNone}
          className="flex-1 px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
        >
          Select None
        </button>
      </div>

      {/* Selection Status */}
      <div className="text-sm text-gray-600 mb-4">
        {selectedCountries.length === 0 && (
          <div className="text-orange-600 font-medium">
            ⚠️ No countries selected
          </div>
        )}
        {selectedCountries.length > 0 && (
          <div>
            {selectedCountries.length} of {SUPPORTED_COUNTRIES.length} countries selected
          </div>
        )}
      </div>

      {/* Country Checkboxes with Stats */}
      <div className="space-y-2 mb-6">
        {isLoading ? (
          <div className="text-sm text-gray-500 py-4 text-center">Loading statistics...</div>
        ) : (
          SUPPORTED_COUNTRIES.map(country => {
            const countryStat = stats?.byCountry.find(s => s.countryCode === country.code);
            const isSelected = selectedCountries.includes(country.code);

            return (
              <label
                key={country.code}
                className={`flex items-center justify-between p-2 rounded cursor-pointer hover:bg-gray-50 ${
                  isSelected ? 'bg-blue-50' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleCountryToggle(country.code)}
                    className="w-4 h-4"
                  />
                  <span className="text-2xl" title={country.code}>{getCountryFlag(country.code)}</span>
                  <span className="text-sm text-gray-600">{country.name}</span>
                </div>
                <div className="text-sm text-gray-600">
                  {countryStat ? (
                    <>
                      {formatKm(countryStat.completedKm)} / {formatKm(countryStat.totalKm)} km
                    </>
                  ) : (
                    '0.0 / 0.0 km'
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
            {' / '}
            <span className="font-semibold">
              {formatKm(stats.total.totalKm)}
            </span>
            {' km'}
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
