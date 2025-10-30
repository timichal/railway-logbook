'use client';

import React from 'react';

interface RailwayRoute {
  track_id: string;
  from_station: string;
  to_station: string;
  track_number?: string | null;
  is_valid?: boolean;
}

interface RoutesListProps {
  routes: RailwayRoute[];
  paginatedRoutes: RailwayRoute[];
  totalRoutes: number;
  invalidRouteCount: number;
  isLoading: boolean;
  selectedRouteId?: string | null;
  searchQuery: string;
  showInvalidOnly: boolean;
  currentPage: number;
  totalPages: number;
  filteredCount: number;
  onSearchChange: (query: string) => void;
  onInvalidOnlyChange: (checked: boolean) => void;
  onRouteClick: (trackId: string) => void;
  onPageChange: (page: number) => void;
}

export default function RoutesList({
  paginatedRoutes,
  totalRoutes,
  invalidRouteCount,
  isLoading,
  selectedRouteId,
  searchQuery,
  showInvalidOnly,
  currentPage,
  totalPages,
  filteredCount,
  onSearchChange,
  onInvalidOnlyChange,
  onRouteClick,
  onPageChange
}: RoutesListProps) {
  return (
    <div className="flex-1 border-r border-gray-200 flex flex-col overflow-hidden">
      {/* Header with Search and Filter */}
      <div className="p-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-gray-900">Routes ({totalRoutes})</h3>
          {/* Invalid Only Filter */}
          <div>
            <label className="flex justify-center items-center cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={showInvalidOnly}
                onChange={(e) => onInvalidOnlyChange(e.target.checked)}
                className="mr-2"
              />
              <span className="text-gray-700">Invalid only ({invalidRouteCount})</span>
            </label>
          </div>
        </div>
        {/* Search Box */}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by route #, from, or to..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
        />
        {searchQuery && (
          <div className="text-xs text-gray-500 mt-1">
            Found {filteredCount} route{filteredCount !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Routes List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-center text-gray-500">Loading...</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {paginatedRoutes.map((route) => (
              <button
                key={route.track_id}
                onClick={() => onRouteClick(route.track_id)}
                className={`w-full p-3 text-left hover:bg-gray-50 focus:bg-blue-50 focus:outline-none ${
                  selectedRouteId === route.track_id ? 'bg-blue-50' : ''
                }`}
              >
                <div className="font-medium text-sm text-gray-900 truncate">
                  {route.from_station} ⟷ {route.to_station} [{route.track_number}]
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      <div className="border-t border-gray-100 flex-shrink-0">
        {totalPages > 1 && (
          <div className="p-3 flex items-center justify-between text-sm">
            <button
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 text-black"
            >
              Previous
            </button>
            <span className="text-gray-600">
              {currentPage}/{totalPages}
            </span>
            <button
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 text-black"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
