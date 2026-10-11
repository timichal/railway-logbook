"use client";

import { useMemo, useRef } from "react";
import MapProgressBox from "@/components/map/MapProgressBox";
import MapStationSearch from "@/components/map/MapStationSearch";
import { createPublicDataAccess } from "@/lib/dataAccess";
import { createRailwayRoutesSource } from "@/lib/map";
import { useUserMap } from "@/lib/map/hooks/useUserMap";
import { useUserMapInteractions } from "@/lib/map/hooks/useUserMapInteractions";
import { useRegion } from "@/lib/regionContext";

interface PublicRailwayMapProps {
  /**
   * Sharing token from the URL — stands in for a session on every data call,
   * the route tiles included: they are coloured by the owner whose token it is.
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
 * `userMapLayers`), coloured by the *owner's* rides: the route tile is asked for
 * with the share token, which the tile handler resolves to its owner on every
 * tile — so switching sharing off stops the tiles too, not just the numbers: an
 * open map stops drawing routes (404s) rather than showing them all unridden.
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

  // Nothing here logs a journey, so there is no tile refresh to drive: the token and
  // the owner's filter are fixed for the page, and a change to either rebuilds. The
  // filter by content, so a parent handing down a fresh but equal array costs nothing.
  const { map, mapLoaded, progress, lineHighlight } = useUserMap(mapContainer, {
    dataAccess,
    selectedCountries,
    routesSource: (countries) =>
      createRailwayRoutesSource({ rides: { shareToken: token }, selectedCountries: countries }),
    rebuildOn: [token, selectedCountries.join(",")],
    // The owner's numbers, whatever the visitor has switched off
    progressFollowsLayers: false,
  });

  // Read-only: `onRouteClick` is deliberately omitted, so there is nothing to
  // select. A tap on a route still opens its info sheet — on a phone that is the
  // only way to read one here.
  useUserMapInteractions(map, mapLoaded, { region: region.id });

  return (
    <div className="h-full w-full relative">
      <div ref={mapContainer} className="w-full h-full" style={{ minHeight: "400px" }} />

      {/* Progress Stats Box */}
      {progress && (
        <MapProgressBox
          progress={progress}
          isMobile={isMobile}
          // A shared map has no menu to move them into.
          withLayerToggles
        />
      )}

      <MapStationSearch
        map={map}
        lineHighlight={lineHighlight}
        region={region.id}
        isMobile={isMobile}
      />
    </div>
  );
}
