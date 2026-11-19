/**
 * The map's top row: the search, the highlight chip, the planner button — and under
 * it, the searched line's chip while there is one.
 *
 * One row in one safe-area box rather than three pieces placed separately. The map
 * runs under the status bar, so everything over its top edge needs the inset, and
 * pieces positioned each on their own meet: the open search spans the width and lands
 * on the planner button, and a chip moved down to the inset lands on the open search.
 *
 * So the row has two states. Collapsed, it is search · chip · planner, with the chip
 * centred in what the two buttons leave, and the line chip on a row of its own below,
 * under the search it came from (`LineChip`). Open, the search field **replaces**
 * both — it is being typed into, and the chips and the planner come back when it
 * closes. Open, the box also runs down to just above the progress box, so the results
 * list has a height to scroll within rather than running off the map.
 *
 * `box-none` throughout, so the row's empty stretches pass taps to the map beneath.
 */
import type { LineSearchResult, Station } from "@shared/types";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HighlightChip } from "@/map/HighlightChip";
import { LineChip } from "@/map/LineChip";
import { MapSearchButton, MapStationSearch } from "@/map/MapStationSearch";
import { PlannerButton } from "@/map/PlannerButton";
import type { LineHighlight } from "@/map/useLineHighlight";

/** The gap between the rows, and between the furniture and the map's edges. */
export const TOP_CONTROLS_GAP = 8;

/**
 * Where the open search stops: clear of the progress box along the map's bottom
 * edge (a 44pt control 8pt in), which is drawn over this and would take the taps
 * meant for the list's last rows.
 */
const OPEN_SEARCH_BOTTOM = TOP_CONTROLS_GAP + 44 + TOP_CONTROLS_GAP;

export function MapTopControls({
  onSelectStation,
  onSelectLine,
  lineHighlight,
}: {
  onSelectStation(station: Station): void;
  onSelectLine(line: LineSearchResult): void;
  lineHighlight: LineHighlight;
}): ReactNode {
  const insets = useSafeAreaInsets();
  const [searching, setSearching] = useState(false);

  if (searching) {
    return (
      <View
        pointerEvents="box-none"
        className="absolute inset-x-2"
        style={{ top: insets.top + TOP_CONTROLS_GAP, bottom: OPEN_SEARCH_BOTTOM }}
      >
        <MapStationSearch
          onSelectStation={onSelectStation}
          onSelectLine={onSelectLine}
          onClose={() => setSearching(false)}
        />
      </View>
    );
  }

  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-x-2"
      style={{ top: insets.top + TOP_CONTROLS_GAP, gap: TOP_CONTROLS_GAP }}
    >
      <View pointerEvents="box-none" className="flex-row items-start gap-2">
        <MapSearchButton onPress={() => setSearching(true)} />
        <View pointerEvents="box-none" className="flex-1 items-center">
          <HighlightChip />
        </View>
        <PlannerButton />
      </View>
      <LineChip highlight={lineHighlight} />
    </View>
  );
}
