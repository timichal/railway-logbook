/**
 * The map's top furniture: the search bar across the width, and under it a row of
 * chips for what the map is showing — the searched line's (`LineChip`) and a
 * highlighted journey's or plan's (`HighlightChip`) — while there are any. (The
 * planner's button is at the bottom, where the thumb is: `PlannerButton`.)
 *
 * One row in one safe-area box rather than three pieces placed separately. The map
 * runs under the status bar, so everything over its top edge needs the inset, and
 * pieces positioned each on their own meet: a chip moved down to the inset lands on
 * the open search.
 *
 * So there are two states. Collapsed, it is the bar and the chip row. Open, the search
 * field **replaces** both — it is being typed into, and the chips come back when it
 * closes. The chips share one row, each shrinking to one line, so the map's fits
 * reserve one row's height for them (`CHIP_ROW_HEIGHT`). Open, the box also runs down to just above the bottom furniture, or the
 * keyboard where that is higher (`OpenSearch`), so the results list has a height to
 * scroll within rather than running off the map or behind the keyboard.
 *
 * `box-none` throughout, so the row's empty stretches pass taps to the map beneath.
 */
import type { LineSearchResult, Station } from "@shared/types";
import { type ReactNode, useRef, useState } from "react";
import { type HostInstance, Keyboard, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHighlight } from "@/logbook/HighlightContext";
import { HighlightChip } from "@/map/HighlightChip";
import { LINE_CHIP_HEIGHT, LineChip } from "@/map/LineChip";
import { MapSearchBar, MapStationSearch } from "@/map/MapStationSearch";
import { PLANNER_BUTTON_HEIGHT } from "@/map/PlannerButton";
import type { LineHighlight } from "@/map/useLineHighlight";
import { useKeyboardTop } from "@/ui/useKeyboardTop";

/** The gap between the rows, and between the furniture and the map's edges. */
export const TOP_CONTROLS_GAP = 8;

/** Above the map's other furniture, drawn after the search (see `OpenSearch`). */
const OPEN_SEARCH_LAYER = { zIndex: 10, elevation: 20 };

/** The chip row under the bar, both chips being 44pt pills. */
export const CHIP_ROW_HEIGHT = LINE_CHIP_HEIGHT;

/**
 * Where the open search stops: clear of the furniture along the map's bottom edge
 * (the progress box and the taller planner button, 8pt in), which is drawn over this
 * and would take the taps meant for the list's last rows. Measured from the floor
 * that furniture stands on (the selection bar, `RailwayMap`'s `footer`).
 */
const OPEN_SEARCH_BOTTOM = TOP_CONTROLS_GAP + PLANNER_BUTTON_HEIGHT + TOP_CONTROLS_GAP;

export function MapTopControls({
  onSelectStation,
  onSelectLine,
  lineHighlight,
  plannerCover,
  floor,
}: {
  onSelectStation(station: Station): void;
  onSelectLine(line: LineSearchResult): void;
  lineHighlight: LineHighlight;
  /** How much of the map's bottom the planner's sheet covers, or 0 (`plannerSheet.ts`). */
  plannerCover: number;
  /** The height of the bar along the map's bottom edge, or 0 (`RailwayMap`'s `footer`). */
  floor: number;
}): ReactNode {
  const insets = useSafeAreaInsets();
  const [searching, setSearching] = useState(false);
  const { trackIds } = useHighlight();
  const chips = lineHighlight.line !== null || trackIds.length > 0;

  if (searching) {
    return (
      <OpenSearch
        top={insets.top + TOP_CONTROLS_GAP}
        plannerCover={plannerCover}
        floor={floor}
        onSelectStation={onSelectStation}
        onSelectLine={onSelectLine}
        onClose={() => setSearching(false)}
      />
    );
  }

  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-x-2"
      style={{ top: insets.top + TOP_CONTROLS_GAP, gap: TOP_CONTROLS_GAP }}
    >
      <MapSearchBar onPress={() => setSearching(true)} />
      {chips ? (
        <View pointerEvents="box-none" className="flex-row items-start gap-2">
          <LineChip highlight={lineHighlight} />
          <HighlightChip />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The open search, held above the keyboard. The map doesn't move for the keyboard
 * on iOS, so the box's bottom is raised to wherever the keyboard's top edge lands
 * over the map: the map's own bottom edge is measured in window coordinates (an
 * invisible view filling the map) and compared with the keyboard's
 * (`useKeyboardTop`). Where the window resizes instead (Android), the two never
 * overlap and the box keeps its place above the progress box.
 *
 * **A tap anywhere outside it closes it**, as it would a menu: an invisible layer over
 * the whole map takes the tap, keyboard and all. It is raised (`zIndex`) over the
 * map's other furniture too, which `RailwayMap` draws after this, so the progress box
 * or the planner button can't be pressed with a search left open over them. Android
 * stacks siblings by `elevation` before `zIndex` (for drawing and for touches), and
 * the planner button's shadow may be one, so the layers carry an elevation too:
 * without a background they cast no shadow. The layer is not an element for screen
 * readers, which close the search with its ×.
 */
function OpenSearch({
  top,
  plannerCover,
  floor,
  onSelectStation,
  onSelectLine,
  onClose,
}: {
  top: number;
  plannerCover: number;
  floor: number;
  onSelectStation(station: Station): void;
  onSelectLine(line: LineSearchResult): void;
  onClose(): void;
}): ReactNode {
  const keyboardTop = useKeyboardTop();
  const mapRef = useRef<HostInstance>(null);
  const [mapBottom, setMapBottom] = useState<number | null>(null);

  const overlap = keyboardTop !== null && mapBottom !== null ? mapBottom - keyboardTop : 0;
  // Clear of the planner's sheet too, which covers the bottom furniture while it is up
  const bottom = Math.max(
    floor + OPEN_SEARCH_BOTTOM,
    plannerCover + TOP_CONTROLS_GAP,
    overlap + TOP_CONTROLS_GAP,
  );

  return (
    <>
      <View
        ref={mapRef}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        onLayout={() =>
          mapRef.current?.measureInWindow((_x, y, _width, height) => setMapBottom(y + height))
        }
      />
      <Pressable
        accessible={false}
        importantForAccessibility="no"
        onPress={() => {
          Keyboard.dismiss();
          onClose();
        }}
        style={[StyleSheet.absoluteFill, OPEN_SEARCH_LAYER]}
      />
      <View
        pointerEvents="box-none"
        className="absolute inset-x-2"
        style={{ top, bottom, ...OPEN_SEARCH_LAYER }}
      >
        <MapStationSearch
          onSelectStation={onSelectStation}
          onSelectLine={onSelectLine}
          onClose={onClose}
        />
      </View>
    </>
  );
}
