'use client';

import React, { useState, useCallback } from 'react';
import SelectedRoutesList from './SelectedRoutesList';
import JourneyPlanner from './JourneyPlanner';
import CountriesStatsTab from './CountriesStatsTab';
import type { SelectedRoute, Station } from '@/lib/types';

interface RouteNode {
  track_id: number;
  from_station: string;
  to_station: string;
  description: string;
  length_km: number;
}

export type ActiveTab = 'routes' | 'journey' | 'filter';

interface UserSidebarProps {
  selectedRoutes: SelectedRoute[];
  onRemoveRoute: (trackId: string) => void;
  onManageTrips: (route: SelectedRoute) => void;
  onClearAll: () => void;
  onRefreshMap?: () => void;
  onUpdateRoutePartial: (trackId: string, partial: boolean) => void;
  onHighlightRoutes?: (routeIds: number[]) => void;
  onAddRoutesFromPlanner?: (routes: RouteNode[]) => void;
  selectedCountries: string[];
  onCountryChange: (countries: string[]) => void;
  onActiveTabChange?: (tab: ActiveTab) => void;
  onStationClickHandler?: (handler: ((station: Station | null) => void) | null) => void;
  sidebarWidth?: number;
}

export default function UserSidebar({
  selectedRoutes,
  onRemoveRoute,
  onManageTrips,
  onClearAll,
  onRefreshMap,
  onUpdateRoutePartial,
  onHighlightRoutes,
  onAddRoutesFromPlanner,
  selectedCountries,
  onCountryChange,
  onActiveTabChange,
  onStationClickHandler,
  sidebarWidth = 600
}: UserSidebarProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('routes');

  // Notify parent when tab changes
  const handleTabChange = useCallback((tab: ActiveTab) => {
    setActiveTab(tab);
    if (onActiveTabChange) {
      onActiveTabChange(tab);
    }
  }, [onActiveTabChange]);

  // Handle adding routes from journey planner - switches to Routes tab
  const handleAddRoutesFromPlanner = useCallback((routes: RouteNode[]) => {
    // Call parent callback to add routes
    if (onAddRoutesFromPlanner) {
      onAddRoutesFromPlanner(routes);
    }

    // Switch to Routes tab
    handleTabChange('routes');
  }, [onAddRoutesFromPlanner, handleTabChange]);

  return (
    <div style={{ width: `${sidebarWidth}px` }} className="bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
      {/* Tab Headers */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => handleTabChange('routes')}
          className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 ${
            activeTab === 'routes'
              ? 'border-blue-500 text-blue-600 bg-blue-50'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          Route Logger
        </button>
        <button
          onClick={() => handleTabChange('journey')}
          className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 ${
            activeTab === 'journey'
              ? 'border-blue-500 text-blue-600 bg-blue-50'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          Journey Planner
        </button>
        <button
          onClick={() => handleTabChange('filter')}
          className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 ${
            activeTab === 'filter'
              ? 'border-blue-500 text-blue-600 bg-blue-50'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          Country Settings & Stats
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'routes' && (
          <SelectedRoutesList
            selectedRoutes={selectedRoutes}
            onRemoveRoute={onRemoveRoute}
            onManageTrips={onManageTrips}
            onClearAll={onClearAll}
            onRefreshMap={onRefreshMap}
            onUpdateRoutePartial={onUpdateRoutePartial}
            onHighlightRoutes={onHighlightRoutes}
            onAddRoutesFromPlanner={handleAddRoutesFromPlanner}
          />
        )}

        {activeTab === 'journey' && (
          <JourneyPlanner
            onHighlightRoutes={onHighlightRoutes}
            onAddRoutesToSelection={handleAddRoutesFromPlanner}
            onStationClickHandler={onStationClickHandler}
          />
        )}

        {activeTab === 'filter' && (
          <CountriesStatsTab
            selectedCountries={selectedCountries}
            onCountryChange={onCountryChange}
          />
        )}
      </div>
    </div>
  );
}
