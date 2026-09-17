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
 */
import { Ionicons } from "@expo/vector-icons";
import { routeBadges, routeTitle } from "@shared/map/routeFeature";
import type { RegionId } from "@shared/regions";
import type { ReactNode } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import type { MapFeature, RouteFeature } from "@/map/mapFeatures";
import { Button } from "@/ui/Button";

interface FeatureSheetProps {
  feature: MapFeature;
  regionId: RegionId;
  onClose(): void;
}

export function FeatureSheet({ feature, regionId, onClose }: FeatureSheetProps): ReactNode {
  return (
    <View className="absolute inset-x-0 bottom-0 max-h-[60%] rounded-t-2xl border-t border-gray-200 bg-white pb-8 dark:border-gray-700 dark:bg-gray-900">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        className="absolute right-2 top-2 z-10 h-11 w-11 items-center justify-center"
      >
        <Ionicons name="close" size={22} color="#6b7280" />
      </Pressable>
      <ScrollView contentContainerClassName="gap-3 px-5 pb-2 pt-4">
        {feature.kind === "route" ? (
          <RouteBody feature={feature} regionId={regionId} />
        ) : feature.kind === "station" ? (
          <>
            <Text className="pr-8 text-lg font-bold text-gray-900 dark:text-gray-100">
              {feature.name}
            </Text>
            <Text className="text-xs text-gray-600 dark:text-gray-400">Station</Text>
          </>
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

function RouteBody({
  feature,
  regionId,
}: {
  feature: RouteFeature;
  regionId: RegionId;
}): ReactNode {
  const { name, endpoints } = routeTitle(feature, regionId);
  const badges = routeBadges(feature, regionId);

  return (
    <>
      {name ? (
        <View className="gap-0.5 pr-8">
          <Text className="text-lg font-bold text-gray-900 dark:text-gray-100">{name}</Text>
          <Text className="text-base text-gray-900 dark:text-gray-100">{endpoints}</Text>
        </View>
      ) : (
        <Text className="pr-8 text-lg font-bold text-gray-900 dark:text-gray-100">{endpoints}</Text>
      )}

      <View className="flex-row flex-wrap items-center gap-1">
        {badges.map((badge) => (
          <View
            key={badge.label}
            className="rounded px-1.5 py-0.5"
            style={{ backgroundColor: badge.bgColor }}
          >
            <Text className="text-xs font-semibold" style={{ color: badge.color }}>
              {badge.label}
            </Text>
          </View>
        ))}
      </View>

      <Text className="text-sm text-gray-600 dark:text-gray-400">
        {feature.lengthKm.toFixed(1)} km
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
            Most recent: {formatJourneyDate(feature.lastJourney.date)} ({feature.lastJourney.name})
          </Text>
        </View>
      ) : null}

      {feature.link ? <LinkButton label="Website" url={feature.link} /> : null}
    </>
  );
}

function LinkButton({ label, url }: { label: string; url: string }): ReactNode {
  return (
    <Button
      label={label}
      variant="outline"
      onPress={() => {
        void Linking.openURL(url);
      }}
    />
  );
}

/** `cs-CZ`, as the web popup formats it. */
function formatJourneyDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("cs-CZ").format(date);
}
