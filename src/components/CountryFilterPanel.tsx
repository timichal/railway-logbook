'use client';

import { useState, useEffect } from 'react';

const COUNTRIES = [
  { code: 'CZ', name: 'Czechia' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'AT', name: 'Austria' },
  { code: 'PL', name: 'Poland' },
  { code: 'DE', name: 'Germany' },
];

interface CountryFilterPanelProps {
  selectedCountries: string[];
  onCountriesChange: (countries: string[]) => void;
}

export default function CountryFilterPanel({
  selectedCountries,
  onCountriesChange,
}: CountryFilterPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const handleCountryToggle = (countryCode: string) => {
    const newSelection = selectedCountries.includes(countryCode)
      ? selectedCountries.filter(c => c !== countryCode)
      : [...selectedCountries, countryCode];

    onCountriesChange(newSelection);
  };

  const handleSelectAll = () => {
    onCountriesChange(COUNTRIES.map(c => c.code));
  };

  const handleSelectNone = () => {
    onCountriesChange([]);
  };

  return (
    <div className="absolute top-16 right-12 bg-white rounded-lg shadow-lg z-10 max-w-xs">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 rounded-t-lg transition-colors"
      >
        <span className="font-semibold text-gray-900">Country Filter</span>
        <svg
          className={`w-5 h-5 text-gray-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 pb-3 border-t border-gray-200">
          {/* Quick Actions */}
          <div className="flex gap-2 py-3">
            <button
              onClick={handleSelectAll}
              className="flex-1 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
            >
              Select All
            </button>
            <button
              onClick={handleSelectNone}
              className="flex-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
            >
              Select None
            </button>
          </div>

          {/* Country Checkboxes */}
          <div className="space-y-2">
            {COUNTRIES.map(country => (
              <label
                key={country.code}
                className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedCountries.includes(country.code)}
                  onChange={() => handleCountryToggle(country.code)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 select-none">
                  {country.name}
                </span>
              </label>
            ))}
          </div>

          {/* Status */}
          <div className="mt-3 pt-3 border-t border-gray-200">
            <p className="text-xs text-gray-500">
              {selectedCountries.length === 0 ? (
                <span className="text-orange-600 font-medium">No countries selected - map will be empty</span>
              ) : selectedCountries.length === COUNTRIES.length ? (
                <span>All countries selected</span>
              ) : (
                <span>{selectedCountries.length} of {COUNTRIES.length} countries selected</span>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
