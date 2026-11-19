/**
 * What the web app's hover popups and touch sheets say, as a bottom sheet.
 *
 * The web app has one of these per input device — a hover popup for a pointer, a
 * tap sheet for a finger, and a `sheetTookThisClick` apparatus to keep a
 * browser-synthesized mouse event from making them fight. None of that exists here:
 * there is only a finger, and a press arrives through the source's own `onPress`
 * with the topmost layer winning, so the note-beats-station-beats-route precedence
 * the web hand-codes is the binding's default.
 *
 * The badges and the heading come from `@shared/map/routeFeature` — the same
 * decisions the web popup renders as HTML spans.
 *
 * **A station is where a plan starts.** On the web a station clicked on the map fills
 * the planner's focused field, or From, then To, because the planner sits beside the
 * map. Here no field is focused while the map is in view, so the sheet says which end
 * the station is: From, To, or a via. The map places it (`onPlan`, then
 * `PlannerContext.placeFromMap`) and opens the planner over the lower half of the map,
 * which searches as soon as both ends are in.
 *
 * **Raised above the planner while its sheet is up** (`bottom`): it covers the lower
 * half of the map, and a sheet opened under it could not be seen. Raised, it is a card
 * with a gap below, rather than a sheet joined to the planner's.
 */
import { Ionicons } from "@expo/vector-icons";
import { formatDateOnly } from "@shared/getUntimezonedDateStr";
import { routeBadges, routeTitle } from "@shared/map/routeFeature";
import type { RegionId } from "@shared/regions";
import type { Station } from "@shared/types";
import type { ReactNode } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import type { PlannerEnd } from "@/logbook/PlannerContext";
import { useSelection } from "@/logbook/SelectionContext";
import type { MapFeature, RouteFeature, StationFeature } from "@/map/mapFeatures";
import { useNativeColors } from "@/theme/colors";
import { useTheme } from "@/theme/ThemeContext";
import { Button } from "@/ui/Button";
import { formatKm } from "@/ui/format";

interface FeatureSheetProps {
  feature: MapFeature;
  regionId: RegionId;
  /** How far up from the map's bottom edge it sits: 0, or the planner sheet's cover. */
  bottom: number;
  /** Its tallest, where the room above the planner sheet is less than 60% of the map. */
  maxHeight?: number;
  /** Its measured height, which the map's bottom furniture rides above. */
  onHeight?(height: number): void;
  onPlan(station: Station, end: PlannerEnd): void;
  onClose(): void;
}

/** The gap between a raised sheet and the planner's. */
export const RAISED_GAP = 8;

export function FeatureSheet({
  feature,
  regionId,
  bottom,
  maxHeight,
  onHeight,
  onPlan,
  onClose,
}: FeatureSheetProps): ReactNode {
  const colors = useNativeColors();
  const raised = bottom > 0;
  return (
    <View
      onLayout={(event) => onHeight?.(event.nativeEvent.layout.height)}
      style={raised ? { bottom: bottom + RAISED_GAP, maxHeight } : undefined}
      className={`absolute bg-white dark:bg-gray-900 ${
        raised
          ? "inset-x-2 rounded-2xl border border-gray-200 pb-3 dark:border-gray-700"
          : "inset-x-0 bottom-0 max-h-[60%] rounded-t-2xl border-t border-gray-200 pb-8 dark:border-gray-700"
      }`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        className="absolute right-2 top-2 z-10 h-11 w-11 items-center justify-center"
      >
        <Ionicons name="close" size={22} color={colors.icon} />
      </Pressable>
      <ScrollView contentContainerClassName="gap-3 px-5 pb-2 pt-4">
        {feature.kind === "route" ? (
          <RouteBody feature={feature} regionId={regionId} />
        ) : feature.kind === "station" ? (
          <StationBody feature={feature} onPlan={onPlan} />
        ) : (
          <>
            <Text className="pr-8 text-base text-gray-900 dark:text-gray-100">{feature.text}</Text>
            {feature.source ? <LinkButton label="Source" url={feature.source} /> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StationBody({
  feature,
  onPlan,
}: {
  feature: StationFeature;
  onPlan(station: Station, end: PlannerEnd): void;
}): ReactNode {
  const { station } = feature;
  const plan = (end: PlannerEnd): void => {
    if (station) onPlan(station, end);
  };

  return (
    <>
      <Text className="pr-8 text-lg font-bold text-gray-900 dark:text-gray-100">
        {feature.name}
      </Text>
      <Text className="text-xs text-gray-600 dark:text-gray-400">Station</Text>
      {station ? (
        <>
          <View className="flex-row gap-2">
            <Button label="Plan from here" className="flex-1" onPress={() => plan("from")} />
            <Button label="Plan to here" className="flex-1" onPress={() => plan("to")} />
          </View>
          <Button label="Add as via" variant="outline" onPress={() => plan("via")} />
        </>
      ) : null}
    </>
  );
}

function RouteBody({
  feature,
  regionId,
}: {
  feature: RouteFeature;
  regionId: RegionId;
}): ReactNode {
  const { name, alsoOn, endpoints } = routeTitle(feature, regionId);
  const badges = routeBadges(feature, regionId);
  const { resolved: theme } = useTheme();
  const { isSelected, toggle, editing } = useSelection();
  // The button says what it is about to do, as the web app's touch sheet does: here
  // the tap opens the sheet and the button is what acts, so it has to be readable
  // before it is pressed.
  const picked = isSelected(feature.trackId);

  return (
    <>
      {name ? (
        <View className="gap-0.5 pr-8">
          <Text className="text-lg font-bold text-gray-900 dark:text-gray-100">{name}</Text>
          {alsoOn && <Text className="text-sm text-gray-600 dark:text-gray-400">{alsoOn}</Text>}
          <Text className="text-base text-gray-900 dark:text-gray-100">{endpoints}</Text>
        </View>
      ) : (
        <Text className="pr-8 text-lg font-bold text-gray-900 dark:text-gray-100">{endpoints}</Text>
      )}

      <View className="flex-row flex-wrap items-center gap-1">
        {badges.map((badge) => {
          const colors = theme === "dark" ? badge.dark : badge;
          return (
            <View
              key={badge.label}
              className="rounded px-1.5 py-0.5"
              style={{ backgroundColor: colors.bgColor }}
            >
              <Text className="text-xs font-semibold" style={{ color: colors.color }}>
                {badge.label}
              </Text>
            </View>
          );
        })}
      </View>

      <Text className="text-sm text-gray-600 dark:text-gray-400">
        {formatKm(feature.lengthKm)} km
      </Text>

      {feature.description ? (
        <Text className="text-sm text-gray-900 dark:text-gray-100">
          <Text className="font-bold">Note: </Text>
          {feature.description}
        </Text>
      ) : null}

      {feature.lastJourney ? (
        <View className="gap-1 border-t border-gray-200 pt-2 dark:border-gray-700">
          <Text className="text-sm text-gray-700 dark:text-gray-300">
            Most recent: {formatDateOnly(feature.lastJourney.date)} ({feature.lastJourney.name})
          </Text>
        </View>
      ) : null}

      <Button
        // During an edit the selection is the journey being edited
        label={
          editing
            ? picked
              ? "Remove from the journey"
              : "Add to the journey"
            : picked
              ? "Remove from selection"
              : "Add to selection"
        }
        variant={picked ? "secondary" : "primary"}
        onPress={() => toggle(feature)}
      />

      {feature.link ? <LinkButton label={feature.linkLabel} url={feature.link} /> : null}
    </>
  );
}

function LinkButton({ label, url }: { label: string; url: string }): ReactNode {
  return (
    <Button
      label={label}
      variant="outline"
      external
      onPress={() => {
        void Linking.openURL(url);
      }}
    />
  );
}
