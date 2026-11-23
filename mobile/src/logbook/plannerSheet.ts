/**
 * The planner's sheet: how it is presented (`app/_layout.tsx`), and how much of the
 * map its lower height covers (`RailwayMap`).
 *
 * **Half the screen, over a map that stays live.** A plan is about where it goes, so
 * the planner opens at half height with the map above it undimmed and touchable:
 * the gold path is fitted into the part still showing, a station tapped there opens
 * its sheet above the planner's, and a drag (or a scroll to the form's edge) raises
 * the planner to full height. Apple Maps' own sheet works this way.
 *
 * The native sheet doesn't report where it is, so the map works out what the half
 * height covers. A detent is a fraction of the largest sheet's height, which is the
 * window less its top inset (iOS's large sheet stops below the status bar; Android's
 * measures against the same height while `sheetShouldOverflowTopInset` is off).
 * Within a few points, which the fit's own gap absorbs.
 *
 * **Only the half height is allowed for.** Dragged to full height the sheet covers
 * the map, so nothing aimed at it can be seen anyway; raised by the keyboard, it
 * comes back down before a fit can matter, since a station picked from a slot's
 * results dismisses the keyboard before the search answers. Tracking the real
 * position (`sheetOnDetentChange`, the keyboard's frame) is the fix if either ever
 * shows.
 */
import type { NativeStackNavigationOptions } from "expo-router";

/** Half height to start with, full height on a drag. */
const DETENTS = [0.5, 1];

export const PLANNER_SHEET_OPTIONS: NativeStackNavigationOptions = {
  presentation: "formSheet",
  sheetAllowedDetents: DETENTS,
  sheetInitialDetentIndex: 0,
  // The half height leaves the map undimmed and taking touches; full height dims it
  sheetLargestUndimmedDetentIndex: 0,
  sheetGrabberVisible: true,
};

/** How much of a map running from the window's top to `mapHeight` the half sheet covers. */
export function plannerSheetCover(
  mapHeight: number,
  windowHeight: number,
  insetTop: number,
): number {
  const sheetHeight = DETENTS[0] * (windowHeight - insetTop);
  return Math.max(0, Math.round(mapHeight - (windowHeight - sheetHeight)));
}
