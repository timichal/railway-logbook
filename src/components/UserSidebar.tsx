'use client';

import React, { useState, useCallback } from 'react';
import type { User } from '@/lib/authActions';
import type { DataAccess } from '@/lib/dataAccess';
import SelectedRoutesList from './SelectedRoutesList';
import JourneyPlanner from './JourneyPlanner';
import CountriesStatsTab from './CountriesStatsTab';
import HowToUseArticle from './HowToUseArticle';
import RailwayNotesArticle from './RailwayNotesArticle';
import type { SelectedRoute, Station } from '@/lib/types';

interface RouteNode {
  track_id: number;
  from_station: string;
  to_station: string;
  description: string;
  length_km: number;
}

export type ActiveTab = 'routes' | 'journey' | 'filter' | 'howto' | 'notes';

interface UserSidebarProps {
  user: User | null;
  dataAccess: DataAccess;
  selectedRoutes: SelectedRoute[];
  onRemoveRoute: (trackId: string) => void;
  onManageTrips: (route: SelectedRoute) => void;
  onClearAll: () => void;
  onUpdateRoutePartial: (trackId: string, partial: boolean) => void;
  onHighlightRoutes?: (routeIds: number[]) => void;
  onAddRoutesFromPlanner?: (routes: RouteNode[]) => void;
  onRoutesLogged?: () => void;
  selectedCountries: string[];
  onCountryChange: (countries: string[]) => void;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  onStationClickHandler?: (handler: ((station: Station | null) => void) | null) => void;
  sidebarWidth?: number;
}

export default function UserSidebar({
  user,
  dataAccess,
  selectedRoutes,
  onRemoveRoute,
  onManageTrips,
  onClearAll,
  onUpdateRoutePartial,
  onHighlightRoutes,
  onAddRoutesFromPlanner,
  onRoutesLogged,
  selectedCountries,
  onCountryChange,
  activeTab,
  setActiveTab,
  onStationClickHandler,
  sidebarWidth = 600
}: UserSidebarProps) {

  // Handle adding routes from journey planner - switches to Routes tab
  const handleAddRoutesFromPlanner = useCallback((routes: RouteNode[]) => {
    // Call parent callback to add routes
    if (onAddRoutesFromPlanner) {
      onAddRoutesFromPlanner(routes);
    }

    // Switch to Routes tab
    setActiveTab('routes');
  }, [onAddRoutesFromPlanner, setActiveTab]);

  // Close article tabs - switches back to Route Logger
  const handleCloseArticle = useCallback(() => {
    setActiveTab('routes');
  }, [setActiveTab]);

  // Check if we're in article mode
  const isArticleMode = activeTab === 'howto' || activeTab === 'notes';

  return (
    <div style={{ width: `${sidebarWidth}px` }} className="bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
      {/* Tab Headers - hide when in article mode */}
      {!isArticleMode && (
        <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('routes')}
          className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 ${
            activeTab === 'routes'
              ? 'border-blue-500 text-blue-600 bg-blue-50'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          Route Logger
        </button>
        <button
          onClick={() => setActiveTab('journey')}
          className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 ${
            activeTab === 'journey'
              ? 'border-blue-500 text-blue-600 bg-blue-50'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          Journey Planner
        </button>
        <button
          onClick={() => setActiveTab('filter')}
          className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 ${
            activeTab === 'filter'
              ? 'border-blue-500 text-blue-600 bg-blue-50'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          Country Settings & Stats
        </button>
        </div>
      )}

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'routes' && (
          <SelectedRoutesList
            user={user}
            dataAccess={dataAccess}
            selectedRoutes={selectedRoutes}
            onRemoveRoute={onRemoveRoute}
            onManageTrips={onManageTrips}
            onClearAll={onClearAll}
            onUpdateRoutePartial={onUpdateRoutePartial}
            onHighlightRoutes={onHighlightRoutes}
            onAddRoutesFromPlanner={handleAddRoutesFromPlanner}
            onRoutesLogged={onRoutesLogged}
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
            dataAccess={dataAccess}
            selectedCountries={selectedCountries}
            onCountryChange={onCountryChange}
          />
        )}

        {activeTab === 'howto' && (
          <HowToUseArticle onClose={handleCloseArticle} />
        )}

        {activeTab === 'notes' && (
          <RailwayNotesArticle onClose={handleCloseArticle} />
        )}
      </div>
    </div>
  );
}
