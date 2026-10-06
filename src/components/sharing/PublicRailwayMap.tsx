"use client";

import { useEffect, useMemo, useRef } from "react";
import MapProgressBox from "@/components/map/MapProgressBox";
import MapStationSearch from "@/components/map/MapStationSearch";
import { createPublicDataAccess } from "@/lib/dataAccess";
import {
  createPublicNotesSource,
  createPublicStationsSource,
  createRailwayRoutesSource,
  createScenicLinesSource,
} from "@/lib/map";
import { useCoverageOverlay } from "@/lib/map/hooks/useCoverageOverlay";
import { useLayerFilters } from "@/lib/map/hooks/useLayerFilters";
import { useMapLibre } from "@/lib/map/hooks/useMapLibre";
import { useRouteEditor } from "@/lib/map/hooks/useRouteEditor";
import { useUserMapInteractions } from "@/lib/map/hooks/useUserMapInteractions";
import { useLayerPrefs } from "@/lib/map/layerPrefsContext";
import { useRegion } from "@/lib/regionContext";
import { createUserMapLayers } from "@/lib/shared/map/userMapLayers";
import { regionCountryCodes } from "@/lib/shared/regions";
import { useResolvedTheme } from "@/lib/theme";

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
  const layerPrefs = useLayerPrefs();
  const dataAccess = useMemo(() => createPublicDataAccess(token, region.id), [token, region.id]);

  // Same rule as the interactive map: a single-country region pins the filter to
  // its own list, which is what keeps the other region's network out of view.
  const effectiveCountries = useMemo(
    () => (region.hasCountryFilter ? selectedCountries : regionCountryCodes(region.id)),
    [region, selectedCountries],
  );

  // The station dots and their labels are picked against the basemap under them, so
  // they follow the scheme. useMapLibre rebuilds the map when it changes.
  const theme = useResolvedTheme();

  const { map, mapLoaded } = useMapLibre(
    mapContainer,
    {
      region: region.id,
      sources: () => ({
        railway_routes: createRailwayRoutesSource({
          rides: { shareToken: token },
          selectedCountries: effectiveCountries,
        }),
        stations: createPublicStationsSource(),
        scenic_lines: createScenicLinesSource(),
        public_notes: createPublicNotesSource(),
      }),
      layers: () => createUserMapLayers(theme),
    },
    [token, effectiveCountries, region.id],
  );

  // Progress figures and the heritage/special toggles. Nothing here logs a
  // journey, so there is no tile refresh to drive.
  const routeEditor = useRouteEditor(dataAccess, effectiveCountries);

  useCoverageOverlay(map, mapLoaded, dataAccess, effectiveCountries, 0);
  useLayerFilters(
    map,
    layerPrefs.showHeritage,
    layerPrefs.showSpecial,
    // The stored preference is shared across regions; one that offers no scenic
    // lines keeps them off regardless of what the other region left switched on.
    layerPrefs.showScenicLines && region.hasScenicHighlight,
    effectiveCountries,
    mapLoaded,
  );

  useEffect(() => {
    if (mapLoaded) routeEditor.refreshProgress();
  }, [mapLoaded, routeEditor.refreshProgress]);

  // Read-only: `onRouteClick` is deliberately omitted, so there is nothing to
  // select. A tap on a route still opens its info sheet — on a phone that is the
  // only way to read one here.
  useUserMapInteractions(map, mapLoaded, { region: region.id });

  return (
    <div className="h-full w-full relative">
      <div ref={mapContainer} className="w-full h-full" style={{ minHeight: "400px" }} />

      {/* Progress Stats Box */}
      {routeEditor.progress && (
        <MapProgressBox
          progress={routeEditor.progress}
          isMobile={isMobile}
          // A shared map has no menu to move them into.
          withLayerToggles
        />
      )}

      <MapStationSearch map={map} region={region.id} isMobile={isMobile} />
    </div>
  );
}
