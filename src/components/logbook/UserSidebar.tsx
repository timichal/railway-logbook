"use client";

import { useEffect } from "react";
import CountriesStatsTab from "@/components/logbook/CountriesStatsTab";
import JourneyLogger from "@/components/logbook/JourneyLogger";
import JourneysAndTripsTab from "@/components/logbook/JourneysAndTripsTab";
import LocalJourneyLogTab from "@/components/logbook/LocalJourneyLogTab";
import LocalTripLogger from "@/components/logbook/LocalTripLogger";
import type { User } from "@/lib/authActions";
import type { DataAccess } from "@/lib/dataAccess";
import { useRegion } from "@/lib/regionContext";
import type {
  HighlightRoutesFn,
  JourneyEditStartFn,
  PlannerRoute,
  SelectedRoute,
  Station,
} from "@/lib/types";
import { tabBtn } from "@/lib/ui/buttonStyles";

/**
 * The sidebar is the three logging tabs and nothing else. "howto"/"notes" used to be
 * tabs here too, taking over the whole pane with their own close button; they are
 * rows in the hamburger menu now, which is where the rest of the app's reading and
 * settings live.
 */
export type ActiveTab = "routes" | "journeylog" | "filter";

interface UserSidebarProps {
  user: User | null;
  dataAccess: DataAccess;
  selectedRoutes: SelectedRoute[];
  onRemoveRoute: (trackId: number) => void;
  onClearAll: () => void;
  onUpdateRoutePartial: (trackId: number, partial: boolean) => void;
  onHighlightRoutes?: HighlightRoutesFn;
  onAddRoutesFromPlanner?: (routes: PlannerRoute[]) => void;
  onRoutesLogged?: () => void;
  selectedCountries: string[];
  onCountryChange: (countries: string[]) => void;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  onStationClickHandler?: (handler: ((station: Station | null) => void) | null) => void;
  sidebarWidth?: number | null;
  onJourneyEditStart?: JourneyEditStartFn;
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
  onJourneyEditEnd,
}: UserSidebarProps) {
  const region = useRegion();

  // A single-country region has nothing to filter, so its Countries tab is gone.
  // Switching into one while that tab is open would leave an empty pane, so the
  // sidebar falls back to the Route Logger.
  useEffect(() => {
    if (!region.hasCountryFilter && activeTab === "filter") setActiveTab("routes");
  }, [region.hasCountryFilter, activeTab, setActiveTab]);

  return (
    <div
      style={sidebarWidth != null ? { width: `${sidebarWidth}px` } : undefined}
      // The right border belongs to the desktop sidebar, which has a map beside it.
      // In the mobile sheet it is a hairline down the inside of a rounded panel.
      className={`bg-white flex flex-col ${
        sidebarWidth != null ? "border-r border-gray-200 flex-shrink-0" : "flex-1 min-h-0"
      }`}
    >
      <div className="flex border-b border-gray-200">
        <button
          type="button"
          onClick={() => setActiveTab("routes")}
          className={tabBtn(activeTab === "routes")}
        >
          <span className="md:hidden">Logger</span>
          <span className="hidden md:inline">Route Logger</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("journeylog")}
          className={tabBtn(activeTab === "journeylog")}
        >
          <span className="md:hidden">{user ? "Trips" : "Journeys"}</span>
          <span className="hidden md:inline">{user ? "My Trips" : "My Journeys"}</span>
        </button>
        {region.hasCountryFilter && (
          <button
            type="button"
            onClick={() => setActiveTab("filter")}
            className={tabBtn(activeTab === "filter")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="inline-block w-4 h-4 mr-1 -mt-0.5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                clipRule="evenodd"
              />
            </svg>
            Countries
          </button>
        )}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "routes" && user && (
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
        {activeTab === "routes" && !user && (
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

        {activeTab === "journeylog" && user && (
          <JourneysAndTripsTab
            onHighlightRoutes={onHighlightRoutes}
            onJourneyChanged={onRoutesLogged}
            onJourneyEditStart={onJourneyEditStart}
            onJourneyEditEnd={onJourneyEditEnd}
          />
        )}

        {activeTab === "journeylog" && !user && (
          <LocalJourneyLogTab
            onHighlightRoutes={onHighlightRoutes}
            onJourneyChanged={onRoutesLogged}
            onJourneyEditStart={onJourneyEditStart}
            onJourneyEditEnd={onJourneyEditEnd}
          />
        )}

        {activeTab === "filter" && region.hasCountryFilter && (
          <CountriesStatsTab
            dataAccess={dataAccess}
            selectedCountries={selectedCountries}
            onCountryChange={onCountryChange}
          />
        )}
      </div>
    </div>
  );
}
