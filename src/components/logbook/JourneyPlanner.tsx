"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import StationSearchInput from "@/components/ui/StationSearchInput";
import ToggleSwitch from "@/components/ui/ToggleSwitch";
import { findRoutePathBetweenStations } from "@/lib/plannerActions";
import { plural } from "@/lib/plural";
import { useRegion } from "@/lib/regionContext";
import type { PlannedStops } from "@/lib/selectedRoutes";
import { MAX_VIA_STATIONS } from "@/lib/shared/constants";
import { hasOrdinaryNonRegular, regionUsagePluralLabel } from "@/lib/shared/regions";
import type { HighlightRoutesFn, PlannerRoute, Station } from "@/lib/shared/types";
import { useToast } from "@/lib/toast";
import { btn, iconBtn, LINK_BTN } from "@/lib/ui/buttonStyles";

/**
 * One station field of the planner: the station picked in it, and the text typed.
 * `key` is the row's identity, so a via row keeps its input when it is moved.
 */
interface Stop {
  key: number;
  station: Station | null;
  query: string;
}

interface JourneyPlannerProps {
  onHighlightRoutes?: HighlightRoutesFn;
  onAddRoutesToSelection?: (routes: PlannerRoute[], stops: PlannedStops) => void;
  onStationClickHandler?: (handler: ((station: Station | null) => void) | null) => void;
}

export default function JourneyPlanner({
  onHighlightRoutes,
  onAddRoutesToSelection,
  onStationClickHandler,
}: JourneyPlannerProps) {
  const regionId = useRegion().id;
  const { showSuccess } = useToast();

  // Whether the search may ride the region's non-Regular ordinary lines (Japan's
  // non-JR ones). Offered only where there are any; on by default, since they are
  // ordinary service there.
  const offersSpecial = hasOrdinaryNonRegular(regionId);
  const [includeSpecial, setIncludeSpecial] = useState(true);

  const nextKeyRef = useRef(0);
  const newStop = (): Stop => ({ key: nextKeyRef.current++, station: null, query: "" });
  // From first, To last, the vias between
  const [stops, setStops] = useState<Stop[]>(() => [newStop(), newStop()]);
  const from = stops[0];
  const to = stops[stops.length - 1];
  const vias = stops.slice(1, -1);

  const [foundPath, setFoundPath] = useState<PlannerRoute[]>([]);
  // Taken when the search ran: the inputs can be edited after it without a new one
  const [foundStops, setFoundStops] = useState<PlannedStops | null>(null);
  const [totalDistance, setTotalDistance] = useState(0);
  const [pathError, setPathError] = useState<string | null>(null);
  const [isSearchingPath, setIsSearchingPath] = useState(false);
  // Only the latest path search may write, so a result from before a region switch
  // or an older click never paints its highlights over a newer one
  const pathRequestRef = useRef(0);

  // Any change to the stops invalidates a search still running for the old ones,
  // whose result would otherwise be painted over a form it no longer matches
  const cancelPathSearch = useCallback(() => {
    pathRequestRef.current++;
    setIsSearchingPath(false);
  }, []);

  const updateStop = useCallback(
    (key: number, update: (stop: Stop) => Partial<Stop>) => {
      cancelPathSearch();
      setStops((prev) => prev.map((s) => (s.key === key ? { ...s, ...update(s) } : s)));
    },
    [cancelPathSearch],
  );

  const pickStation = useCallback(
    (key: number, station: Station) => updateStop(key, () => ({ station, query: station.name })),
    [updateStop],
  );

  // Editing the text drops the station picked in the field, unless it is typed back
  const handleQueryChange = (key: number, query: string) =>
    updateStop(key, (s) => ({ query, station: query === s.station?.name ? s.station : null }));

  // The field a map click fills. A field reports its blur only once it is really left
  // (see `onBlur`), because clicking the map is what blurs it and the click lands
  // after that.
  const activeKeyRef = useRef<number | null>(null);

  // Read only by the map click handler, which stays stable for the parent
  const stopsRef = useRef(stops);
  stopsRef.current = stops;

  // A station clicked on the map fills the focused field, otherwise From, then To
  const handleStationClickFromMap = useCallback(
    (station: Station | null) => {
      if (!station?.id || !station.name) return;
      const current = stopsRef.current;
      const first = current[0];
      const last = current[current.length - 1];
      // A via removed while focused never reports its blur, so its key can outlive it
      const active = current.find((s) => s.key === activeKeyRef.current);
      const target = active ?? (!first.station ? first : !last.station ? last : null);
      if (target) pickStation(target.key, station);
    },
    [pickStation],
  );

  useEffect(() => {
    onStationClickHandler?.(handleStationClickFromMap);
    return () => onStationClickHandler?.(null);
  }, [onStationClickHandler, handleStationClickFromMap]);

  const handleFindPath = async () => {
    const fromStation = from.station;
    const toStation = to.station;
    if (!fromStation || !toStation) {
      setPathError("Please select both from and to stations");
      return;
    }
    const viaStations = vias.flatMap((s) => (s.station ? [s.station] : []));
    if (viaStations.length < vias.length) {
      setPathError("Please select all via stations or remove empty ones");
      return;
    }

    const requestId = ++pathRequestRef.current;
    setIsSearchingPath(true);
    setPathError(null);
    setFoundPath([]);

    try {
      const result = await findRoutePathBetweenStations(
        Number(fromStation.id),
        Number(toStation.id),
        viaStations.map((s) => Number(s.id)),
        { includeSpecial: offersSpecial && includeSpecial },
      );
      if (requestId !== pathRequestRef.current) return;

      if (result.error) {
        setPathError(result.error);
        setTotalDistance(0);
        onHighlightRoutes?.([], "planner");
      } else {
        setFoundPath(result.routes);
        setFoundStops({
          from: fromStation.name,
          via: viaStations.map((s) => s.name),
          to: toStation.name,
        });
        setTotalDistance(result.totalDistance);
        onHighlightRoutes?.(
          result.routes.map((r) => r.track_id),
          "planner",
          // Terminal routes joined mid-way are highlighted along the travelled
          // stretch only, so the gold line stops at the station
          result.routes.flatMap((r) => (r.partial ? [r.partial] : [])),
          { fit: true, bounds: result.bounds },
        );
      }
    } catch (error) {
      if (requestId !== pathRequestRef.current) return;
      console.error("Error finding path:", error);
      setPathError("An error occurred while finding the path");
      setTotalDistance(0);
    } finally {
      if (requestId === pathRequestRef.current) setIsSearchingPath(false);
    }
  };

  // Drops the result and its highlight, keeping the stops
  const clearResult = () => {
    cancelPathSearch();
    setFoundPath([]);
    setFoundStops(null);
    setTotalDistance(0);
    setPathError(null);
    onHighlightRoutes?.([], "planner");
  };

  const resetForm = () => {
    clearResult();
    // From and To keep their keys, so their inputs stay mounted
    setStops((prev) =>
      [prev[0], prev[prev.length - 1]].map((s) => ({ ...s, station: null, query: "" })),
    );
  };

  const handleAddToSelection = () => {
    if (foundPath.length === 0 || !foundStops || !onAddRoutesToSelection) return;
    onAddRoutesToSelection(foundPath, foundStops);
    resetForm();
    showSuccess(`${plural(foundPath.length, "route")} added to selection!`);
  };

  // Switching regions empties the form: the stations in it belong to the region
  // that just went off screen, and searching from them would plot a path the map
  // cannot show.
  // biome-ignore lint/correctness/useExhaustiveDependencies: regionId is the trigger; resetForm is redefined every render and must not re-run this.
  useEffect(() => {
    resetForm();
  }, [regionId]);

  // A new via goes last among the vias, i.e. just before To
  const addViaStation = () => {
    cancelPathSearch();
    setStops((prev) => [...prev.slice(0, -1), newStop(), prev[prev.length - 1]]);
  };

  const removeStop = (key: number) => {
    cancelPathSearch();
    setStops((prev) => prev.filter((s) => s.key !== key));
  };

  // Reorder via stations. Buttons rather than the HTML5 drag-and-drop this used to
  // use: iOS Safari never fires `dragstart` from a touch, so the drag handle was
  // dead on a phone with nothing to say so — and a 16px handle was barely a target
  // even where it worked. Two taps also give keyboard users the reordering that
  // drag-and-drop had no equivalent for.
  const moveViaStation = (viaIndex: number, direction: -1 | 1) => {
    // Vias sit at 1..n in the stop list
    const a = viaIndex + 1;
    const b = a + direction;
    if (b < 1 || b > vias.length) return;
    cancelPathSearch();
    setStops((prev) => {
      const next = [...prev];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
  };

  const fieldProps = (stop: Stop) => ({
    value: stop.query,
    isSelected: !!stop.station,
    onChange: (query: string) => handleQueryChange(stop.key, query),
    onSelect: (station: Station) => pickStation(stop.key, station),
    onFocus: () => {
      activeKeyRef.current = stop.key;
    },
    onBlur: () => {
      if (activeKeyRef.current === stop.key) activeKeyRef.current = null;
    },
  });

  // From and To: the × empties the field, and is shown only once a station is picked
  const clearEndpoint = (stop: Stop) =>
    stop.station ? () => updateStop(stop.key, () => ({ station: null, query: "" })) : undefined;

  return (
    <div className="space-y-3 text-fg">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold">Journey Planner</h3>
        <button type="button" onClick={resetForm} className={LINK_BTN}>
          Clear planner
        </button>
      </div>

      <StationSearchInput
        id="planner-from-station"
        label="From Station"
        placeholder="Search from station..."
        selectedClassName="border-blue-300 bg-blue-50"
        clearLabel="Clear from station"
        onClear={clearEndpoint(from)}
        {...fieldProps(from)}
      />

      {vias.map((stop, viaIndex) => (
        <div key={stop.key} className="flex items-center gap-1">
          {/* Only worth the width once there is something to reorder. */}
          {vias.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => moveViaStation(viaIndex, -1)}
                disabled={viaIndex === 0}
                aria-label={`Move via station ${viaIndex + 1} up`}
                className={`${iconBtn("responsive")} text-xs`}
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => moveViaStation(viaIndex, 1)}
                disabled={viaIndex === vias.length - 1}
                aria-label={`Move via station ${viaIndex + 1} down`}
                className={`${iconBtn("responsive")} text-xs`}
              >
                ▼
              </button>
            </>
          )}
          <StationSearchInput
            containerClassName="flex-1"
            label={`Via station ${viaIndex + 1}`}
            hideLabel
            placeholder={`Search via station ${viaIndex + 1}...`}
            selectedClassName="border-green-300 bg-green-50"
            clearLabel={`Remove via station ${viaIndex + 1}`}
            onClear={() => removeStop(stop.key)}
            {...fieldProps(stop)}
          />
        </div>
      ))}

      {/* Stops at MAX_VIA_STATIONS, which the search refuses beyond — the button
          says so rather than letting the form build a request that comes back as
          an error. */}
      <button
        type="button"
        onClick={addViaStation}
        disabled={vias.length >= MAX_VIA_STATIONS}
        className="w-full px-3 py-2 border-2 border-dashed border-gray-300 rounded-md text-sm font-medium text-gray-600 transition-colors disabled:opacity-50 not-disabled:hover:border-gray-400 not-disabled:hover:text-gray-800 not-disabled:hover:bg-gray-50 not-disabled:active:bg-gray-100"
      >
        {vias.length >= MAX_VIA_STATIONS
          ? `Maximum of ${MAX_VIA_STATIONS} via stations`
          : "+ Add via station"}
      </button>

      <StationSearchInput
        id="planner-to-station"
        label="To Station"
        placeholder="Search to station..."
        selectedClassName="border-blue-300 bg-blue-50"
        clearLabel="Clear to station"
        onClear={clearEndpoint(to)}
        {...fieldProps(to)}
      />

      {/* Flipping it drops the result: a plan over lines just excluded must not
          stay one tap from the selection. */}
      {offersSpecial && (
        <ToggleSwitch
          label={`Include ${regionUsagePluralLabel(regionId, 2)}`}
          checked={includeSpecial}
          onChange={(checked) => {
            clearResult();
            setIncludeSpecial(checked);
          }}
        />
      )}

      <button
        type="button"
        onClick={handleFindPath}
        disabled={!from.station || !to.station || isSearchingPath}
        className={`${btn("primary", "md")} w-full`}
      >
        {isSearchingPath ? "Finding path..." : "Find Path"}
      </button>

      {pathError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {pathError}
        </div>
      )}

      {foundPath.length > 0 && (
        <div>
          <div className="mb-2 p-2 bg-green-50 border border-green-200 rounded text-xs">
            <span className="font-medium text-green-800">
              Found {plural(foundPath.length, "route")} ({totalDistance.toFixed(1)} km)
            </span>
          </div>

          <div className="space-y-1 mb-3 max-h-64 overflow-y-auto bg-gray-50 border border-gray-200 rounded">
            {foundPath.map((route, index) => (
              <div key={route.track_id} className="p-2 text-xs">
                <div className="font-medium">
                  {index + 1}. {route.from_station} ⟷ {route.to_station}
                  <span className="text-gray-600"> {route.travelled_length_km.toFixed(1)} km</span>
                  {route.partial && (
                    <span className="ml-1 text-amber-700">
                      (partial, of {route.length_km.toFixed(1)} km)
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleAddToSelection}
            className={`${btn("primary", "md")} w-full`}
          >
            Add Routes to Selection
          </button>
        </div>
      )}
    </div>
  );
}
