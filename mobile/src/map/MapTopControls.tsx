/**
 * The map's top row: the station search, the highlight chip, the planner button.
 *
 * One row in one safe-area box rather than three pieces placed separately. The map
 * runs under the status bar, so everything over its top edge needs the inset, and
 * pieces positioned each on their own meet: the open search spans the width and lands
 * on the planner button, and a chip moved down to the inset lands on the open search.
 *
 * So the row has two states. Collapsed, it is search · chip · planner, with the chip
 * centred in what the two buttons leave. Open, the search field **replaces** the row
 * — it is being typed into, and the chip and the planner come back when it closes.
 *
 * `box-none` throughout, so the row's empty stretches pass taps to the map beneath.
 */
import type { Station } from "@shared/types";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HighlightChip } from "@/map/HighlightChip";
import { MapSearchButton, MapStationSearch } from "@/map/MapStationSearch";
import { PlannerButton } from "@/map/PlannerButton";

export function MapTopControls({
  onSelectStation,
}: {
  onSelectStation(station: Station): void;
}): ReactNode {
  const insets = useSafeAreaInsets();
  const [searching, setSearching] = useState(false);

  return (
    <View pointerEvents="box-none" className="absolute inset-x-2" style={{ top: insets.top + 8 }}>
      {searching ? (
        <MapStationSearch onSelect={onSelectStation} onClose={() => setSearching(false)} />
      ) : (
        <View pointerEvents="box-none" className="flex-row items-start gap-2">
          <MapSearchButton onPress={() => setSearching(true)} />
          <View pointerEvents="box-none" className="flex-1 items-center">
            <HighlightChip />
          </View>
          <PlannerButton />
        </View>
      )}
    </View>
  );
}
