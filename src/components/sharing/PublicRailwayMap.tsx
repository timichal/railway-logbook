"use client";

import { useMemo, useRef } from "react";
import { MapPaneStatus } from "@/components/layout/MapLoading";
import MapProgressBox from "@/components/map/MapProgressBox";
import MapStationSearch from "@/components/map/MapStationSearch";
import { createPublicDataAccess } from "@/lib/dataAccess";
import { useUserMap } from "@/lib/map/hooks/useUserMap";
import { useUserMapInteractions } from "@/lib/map/hooks/useUserMapInteractions";
import { useRegion } from "@/lib/regionContext";

interface PublicRailwayMapProps {
  /**
   * Sharing token from the URL — stands in for a session on every data call, the
   * rides that colour the routes included: they are the owner's whose token it is.
   */
  token: string;
  /** The owner's country filter, shown exactly as they set it. */
  selectedCountries: string[];
  isMobile: boolean;
}

/**
 * The read-only map behind a share link.
 *
 * Same sources, layers and styling as the interactive map (both build them from
 * `userMapLayers`), coloured by the *owner's* rides, asked for with the share
 * token (`api/shared/<token>/rides`), which the server resolves to its owner on
 * every call. A dead link draws no routes (a 404) rather than all of them
 * unridden; switched off while the map is open, it stops the numbers, and the
 * rides with the next read.
 * What is missing is everything that writes or picks: no sidebar, no route
 * selection, no journey planner, no country controls. Hover popups and the layer
 * toggles stay — they only change what the visitor is looking at.
 */
export default function PublicRailwayMap({
  token,
  selectedCountries,
  isMobile,
}: PublicRailwayMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const region = useRegion();
  const dataAccess = useMemo(() => createPublicDataAccess(token, region.id), [token, region.id]);

  // Nothing here logs a journey, so the rides never need a refresh asked for; the
  // token and the owner's filter are fixed for the page.
  const {
    map,
    mapLoaded,
    mapStatus,
    progress,
    progressFailed,
    progressPending,
    refreshProgress,
    routeRide,
    lineHighlight,
  } = useUserMap(mapContainer, {
    dataAccess,
    selectedCountries,
    // The owner's numbers, whatever the visitor has switched off
    progressFollowsLayers: false,
  });

  // Read-only: `onRouteClick` is deliberately omitted, so there is nothing to
  // select. A tap on a route still opens its info sheet — on a phone that is the
  // only way to read one here.
  useUserMapInteractions(map, mapLoaded, { region: region.id, routeRide });

  return (
    <div className="h-full w-full relative">
      <div ref={mapContainer} className="w-full h-full" style={{ minHeight: "400px" }} />
      <MapPaneStatus status={mapStatus} />

      {/* Progress Stats Box */}
      <MapProgressBox
        progress={progress}
        failed={progressFailed}
        pending={progressPending}
        onRetry={refreshProgress}
        isMobile={isMobile}
        // A shared map has no menu to move them into.
        withLayerToggles
      />

      <MapStationSearch
        map={map}
        lineHighlight={lineHighlight}
        region={region.id}
        isMobile={isMobile}
      />
    </div>
  );
}
