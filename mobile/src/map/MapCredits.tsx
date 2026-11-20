/**
 * Who the map's data comes from: our own ⓘ over the bottom-right corner (above the
 * locate button, in the column `RailwayMap` places), and the card it opens over it.
 *
 * **Not MapLibre's attribution.** On iOS the native ⓘ opens an action sheet with one
 * button per piece of the source's attribution HTML, and OpenFreeMap's TileJSON says
 * `OpenFreeMap © OpenMapTiles Data from OpenStreetMap` with "Data from" as plain text
 * between the links, so the sheet grew a "Data From" button that does nothing. The
 * binding can't relabel the sheet, so the map's own is off (`attribution={false}`)
 * and the credits are written out here. OpenStreetMap's licence asks for its credit
 * to be reachable from the map, which an ⓘ that opens it is.
 *
 * **The list follows the basemap.** OpenFreeMap and OpenMapTiles are credited only
 * while their vector tiles are drawn; the raster fallback (`useBasemapStyle`) is
 * OpenStreetMap's own tiles. OpenStreetMap is always there: every railway is theirs.
 *
 * The card closes on a tap anywhere outside it, as the open search does, and is raised
 * the same way over the map's other furniture (`zIndex`, and `elevation` for Android,
 * where the planner button's shadow is one). The button's background is solid, as the
 * locate button's is, for its shadow.
 */
import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useNativeColors } from "@/theme/colors";

const BUTTON_SIZE = 32;
/** Brings the small button's target up to 44pt. */
const HIT_SLOP = (44 - BUTTON_SIZE) / 2;

const RAISED_LAYER = { zIndex: 10, elevation: 20 };

interface Credit {
  label: string;
  detail: string;
  url: string;
}

const OPENSTREETMAP: Credit = {
  label: "© OpenStreetMap contributors",
  detail: "Railway and map data",
  url: "https://www.openstreetmap.org/copyright",
};
const VECTOR_BASEMAP: Credit[] = [
  {
    label: "© OpenMapTiles",
    detail: "Basemap schema and style",
    url: "https://www.openmaptiles.org/",
  },
  { label: "OpenFreeMap", detail: "Basemap tiles", url: "https://openfreemap.org" },
];

/** The ⓘ. */
export function MapCreditsButton({ onPress }: { onPress(): void }): ReactNode {
  const colors = useNativeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Map data credits"
      hitSlop={HIT_SLOP}
      onPress={onPress}
      style={{ width: BUTTON_SIZE, height: BUTTON_SIZE }}
      className="items-center justify-center rounded-full bg-white shadow-md active:opacity-80 dark:bg-gray-900"
    >
      <Ionicons name="information" size={18} color={colors.iconStrong} />
    </Pressable>
  );
}

/** The card, opening upward from the ⓘ's bottom edge. */
export function MapCredits({
  vectorBasemap,
  bottom,
  onClose,
}: {
  /** OpenFreeMap's vector tiles are drawn, rather than the raster fallback. */
  vectorBasemap: boolean;
  /** Where the ⓘ's bottom edge is, up from the map's. */
  bottom: number;
  onClose(): void;
}): ReactNode {
  const colors = useNativeColors();
  const credits = vectorBasemap ? [OPENSTREETMAP, ...VECTOR_BASEMAP] : [OPENSTREETMAP];

  return (
    <>
      <Pressable
        accessible={false}
        importantForAccessibility="no"
        onPress={onClose}
        style={[StyleSheet.absoluteFill, RAISED_LAYER]}
      />
      <View
        accessibilityViewIsModal
        className="absolute right-2 min-w-64 max-w-[85%] rounded-2xl border border-gray-200 bg-white py-1 shadow-md dark:border-gray-700 dark:bg-gray-900"
        style={{ bottom, ...RAISED_LAYER }}
      >
        <View className="flex-row items-center pl-4">
          <Text
            accessibilityRole="header"
            className="flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100"
          >
            Map data
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            className="h-11 w-11 items-center justify-center"
          >
            <Ionicons name="close" size={22} color={colors.icon} />
          </Pressable>
        </View>
        {credits.map((credit) => (
          <Pressable
            key={credit.url}
            accessibilityRole="link"
            accessibilityHint="Opens in the browser"
            onPress={() => void Linking.openURL(credit.url)}
            className="min-h-11 flex-row items-center gap-3 px-4 py-2 active:bg-gray-100 dark:active:bg-gray-800"
          >
            <View className="flex-1">
              <Text className="text-sm font-medium" style={{ color: colors.accent }}>
                {credit.label}
              </Text>
              <Text className="text-xs text-gray-600 dark:text-gray-400">{credit.detail}</Text>
            </View>
            <Ionicons name="open-outline" size={16} color={colors.icon} />
          </Pressable>
        ))}
      </View>
    </>
  );
}
