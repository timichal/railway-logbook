"use client";

import { useCallback, useReducer } from "react";
import JourneyLogger from "@/components/logbook/JourneyLogger";
import JourneysAndTripsTab from "@/components/logbook/JourneysAndTripsTab";
import LocalJourneyLogTab from "@/components/logbook/LocalJourneyLogTab";
import LocalTripLogger from "@/components/logbook/LocalTripLogger";
import MapStatsTab from "@/components/logbook/MapStatsTab";
import type { User } from "@/lib/authActions";
import type { DataAccess } from "@/lib/dataAccess";
import type {
  HighlightRoutesFn,
  JourneyEditStartFn,
  PlannerRoute,
  SelectedRoute,
  Station,
} from "@/lib/shared/types";
import { tabBtn } from "@/lib/ui/buttonStyles";

/**
 * The sidebar is the logging tabs and the map's own controls (Map & Stats), nothing
 * else. "howto"/"notes" used to be tabs here too, taking over the whole pane with
 * their own close button; they are rows in the hamburger menu now, beside the
 * app-wide settings (region, colour scheme).
 */
export type ActiveTab = "routes" | "journeylog" | "map";

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
  sidebarWidth?: string | null;
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
  // The Route Logger's trip picker loaded its trips once and stays mounted while My
  // Trips is open, so a trip created, renamed or deleted there has to be passed on.
  const [tripsVersion, bumpTripsVersion] = useReducer((v: number) => v + 1, 0);
  const handleTripsChanged = useCallback(() => {
    bumpTripsVersion();
    onRoutesLogged?.();
  }, [onRoutesLogged]);

  return (
    <div
      style={sidebarWidth != null ? { width: sidebarWidth } : undefined}
      // The right border belongs to the desktop sidebar, which has a map beside it.
      // In the mobile sheet it is a hairline down the inside of a rounded panel.
      className={`bg-surface flex flex-col ${
        sidebarWidth != null ? "border-r border-gray-200 flex-shrink-0" : "flex-1 min-h-0"
      }`}
    >
      {/* In the mobile sheet the tab bar is also the sheet's drag handle, which is a
          far easier target than the grabber above it alone (see MobileBottomSheet). */}
      <div
        className={`flex border-b border-gray-200 ${sidebarWidth == null ? "touch-none select-none" : ""}`}
        data-sheet-drag={sidebarWidth == null ? "" : undefined}
      >
        <button
          type="button"
          onClick={() => setActiveTab("routes")}
          className={tabBtn(activeTab === "routes")}
        >
          <span className="md:hidden">Logger</span>
          <span className="hidden md:inline">Route Logger</span>
          {/* The selection is built on the map, beside or under this panel, so the tab
              says it grew. Re-keyed on the count so each change replays the bump. */}
          {selectedRoutes.length > 0 && (
            <span
              key={selectedRoutes.length}
              className="count-bump ml-1.5 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-blue-600 text-white text-xs font-semibold leading-none align-[1px]"
            >
              {selectedRoutes.length}
              <span className="sr-only"> selected</span>
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("journeylog")}
          className={tabBtn(activeTab === "journeylog")}
        >
          <span className="md:hidden">{user ? "Trips" : "Journeys"}</span>
          <span className="hidden md:inline">{user ? "My Trips" : "My Journeys"}</span>
        </button>
        {/* Every region has it: the layer switches are there even where there is
            nothing to count (see MapStatsTab). A map glyph, not the cog it had as
            the Countries tab: the app-wide settings are in the hamburger menu, and a
            cog here would send someone looking for them to the wrong place. */}
        <button
          type="button"
          onClick={() => setActiveTab("map")}
          className={tabBtn(activeTab === "map")}
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
              d="M12 1.586l-4 4v12.828l4-4V1.586zM3.707 3.293A1 1 0 002 4v10a1 1 0 00.293.707L6 18.414V5.586L3.707 3.293zM17.707 5.293L14 1.586v12.828l2.293 2.293A1 1 0 0018 16V6a1 1 0 00-.293-.707z"
              clipRule="evenodd"
            />
          </svg>
          <span className="md:hidden">Map</span>
          <span className="hidden md:inline">Map &amp; Stats</span>
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {/* The Route Logger stays mounted while another tab is open, so the planner's
            stops and result and the half-filled journey form are still there on the
            way back (a sign-in or sign-out still rebuilds it, for the other store).
            Its highlights are another matter: RailwayMap shows only the open tab's.
            The other tabs mount fresh each time. */}
        <div hidden={activeTab !== "routes"}>
          {user ? (
            <JourneyLogger
              tripsVersion={tripsVersion}
              selectedRoutes={selectedRoutes}
              onRemoveRoute={onRemoveRoute}
              onClearSelection={onClearAll}
              onUpdateRoutePartial={onUpdateRoutePartial}
              onRoutesLogged={onRoutesLogged || (() => {})}
              onHighlightRoutes={onHighlightRoutes}
              onAddRoutesFromPlanner={onAddRoutesFromPlanner}
              onStationClickHandler={onStationClickHandler}
            />
          ) : (
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
        </div>

        {activeTab === "journeylog" && user && (
          <JourneysAndTripsTab
            onHighlightRoutes={onHighlightRoutes}
            onJourneyChanged={handleTripsChanged}
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

        {activeTab === "map" && (
          <MapStatsTab
            dataAccess={dataAccess}
            selectedCountries={selectedCountries}
            onCountryChange={onCountryChange}
          />
        )}
      </div>
    </div>
  );
}
