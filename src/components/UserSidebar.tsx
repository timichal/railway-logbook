'use client';

import React, { useState, useCallback } from 'react';
import type { User } from '@/lib/authActions';
import type { DataAccess } from '@/lib/dataAccess';
import JourneyLogger from './JourneyLogger';
import LocalTripLogger from './LocalTripLogger';
import JourneyLogTab from './JourneyLogTab';
import LocalJourneyLogTab from './LocalJourneyLogTab';
import CountriesStatsTab from './CountriesStatsTab';
import TripsTab from './TripsTab';
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

export type ActiveTab = 'routes' | 'journeylog' | 'trips' | 'filter' | 'howto' | 'notes';

interface UserSidebarProps {
  user: User | null;
  dataAccess: DataAccess;
  selectedRoutes: SelectedRoute[];
  onRemoveRoute: (trackId: string) => void;
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
  sidebarWidth?: number | null;
  onJourneyEditStart?: (handler: (route: SelectedRoute) => void) => void;
  onJourneyEditEnd?: () => void;
}

export default function UserSidebar({
  user,
  dataAccess,
  selectedRoutes,
  onRemoveRoute,
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
  sidebarWidth,
  onJourneyEditStart,
  onJourneyEditEnd
}: UserSidebarProps) {

  // Close article tabs - switches back to Route Logger
  const handleCloseArticle = useCallback(() => {
    setActiveTab('routes');
  }, [setActiveTab]);

  // Check if we're in article mode
  const isArticleMode = activeTab === 'howto' || activeTab === 'notes';

  return (
    <div style={sidebarWidth != null ? { width: `${sidebarWidth}px` } : undefined} className="bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
      {/* Tab Headers - hide when in article mode */}
      {!isArticleMode && (
        <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('routes')}
          className={`flex-1 py-2 px-2 md:py-3 md:px-4 text-xs md:text-sm font-medium border-b-2 ${
            activeTab === 'routes'
              ? 'border-blue-500 text-blue-600 bg-blue-50'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span className="md:hidden">Logger</span>
          <span className="hidden md:inline">Route Logger</span>
        </button>
        <button
          onClick={() => setActiveTab('journeylog')}
          className={`flex-1 py-2 px-2 md:py-3 md:px-4 text-xs md:text-sm font-medium border-b-2 ${
            activeTab === 'journeylog'
              ? 'border-blue-500 text-blue-600 bg-blue-50'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span className="md:hidden">Journeys</span>
          <span className="hidden md:inline">My Journeys</span>
        </button>
        {user && (
          <button
            onClick={() => setActiveTab('trips')}
            className={`flex-1 py-2 px-2 md:py-3 md:px-4 text-xs md:text-sm font-medium border-b-2 ${
              activeTab === 'trips'
                ? 'border-blue-500 text-blue-600 bg-blue-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span className="md:hidden">Trips</span>
            <span className="hidden md:inline">My Trips</span>
          </button>
        )}
        <button
          onClick={() => setActiveTab('filter')}
          className={`flex-1 py-2 px-2 md:py-3 md:px-4 text-xs md:text-sm font-medium border-b-2 ${
            activeTab === 'filter'
              ? 'border-blue-500 text-blue-600 bg-blue-50'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span className="md:hidden">Countries</span>
          <span className="hidden md:inline">Country Settings & Stats</span>
        </button>
        </div>
      )}

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'routes' && user && (
          <JourneyLogger
            selectedRoutes={selectedRoutes}
            onRemoveRoute={onRemoveRoute}
            onClearSelection={onClearAll}
            onUpdateRoutePartial={onUpdateRoutePartial}
            onRoutesLogged={onRoutesLogged || (() => {})}
            onHighlightRoutes={onHighlightRoutes}
            onAddRoutesFromPlanner={onAddRoutesFromPlanner}
            onStationClickHandler={onStationClickHandler}
          />
        )}
        {activeTab === 'routes' && !user && (
          <LocalTripLogger
            selectedRoutes={selectedRoutes}
            onRemoveRoute={onRemoveRoute}
            onClearSelection={onClearAll}
            onUpdateRoutePartial={onUpdateRoutePartial}
            onRoutesLogged={onRoutesLogged || (() => {})}
            onHighlightRoutes={onHighlightRoutes}
            onAddRoutesFromPlanner={onAddRoutesFromPlanner}
            onStationClickHandler={onStationClickHandler}
          />
        )}

        {activeTab === 'journeylog' && user && (
          <JourneyLogTab
            onHighlightRoutes={onHighlightRoutes}
            onJourneyChanged={onRoutesLogged}
            onJourneyEditStart={onJourneyEditStart}
            onJourneyEditEnd={onJourneyEditEnd}
          />
        )}

        {activeTab === 'journeylog' && !user && (
          <LocalJourneyLogTab
            onHighlightRoutes={onHighlightRoutes}
            onJourneyChanged={onRoutesLogged}
          />
        )}

        {activeTab === 'trips' && user && (
          <TripsTab
            onHighlightRoutes={onHighlightRoutes}
            onTripChanged={onRoutesLogged}
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
