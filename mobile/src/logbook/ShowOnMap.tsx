/**
 * Point the map at a trip's or a journey's routes, and take the reader there — the
 * map flies to them, with the box the same request brings back. Pressed again while
 * the map still shows them, it flies there again, in case the reader has panned away.
 *
 * `load` says where the routes come from. A trip's are fetched on the press rather
 * than carried in the list: the logbook page would otherwise ship every track id of
 * every row to draw a button nobody has pressed yet. An open journey has already
 * loaded its own (`JourneyDetails`), and hands them over as they are.
 */
import type { PartialRouteGeometry, RouteBounds } from "@shared/types";
import { useRouter } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useHighlight } from "@/logbook/HighlightContext";
import { useRegion } from "@/region/RegionContext";
import { Button } from "@/ui/Button";

export interface MapTarget {
  trackIds: number[];
  partials: PartialRouteGeometry[];
  bounds: RouteBounds | null;
}

export function ShowOnMap({
  ownerKey,
  label,
  load,
}: {
  /** What the highlight is set on behalf of, e.g. `journey-12`. */
  ownerKey: string;
  label: string;
  load(): Promise<MapTarget>;
}): ReactNode {
  const router = useRouter();
  const { regionId } = useRegion();
  const { highlight, refit, ownerKey: showingKey } = useHighlight();
  // Read after the request, which a region switch may have overtaken: its routes and
  // box are the old region's, and the switch has just cleared the map of those
  const currentRegion = useRef(regionId);
  currentRegion.current = regionId;
  // A card closed while its routes were loading has taken the press back with it:
  // nothing is highlighted and the reader isn't sent to the map
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The map may already be showing this one — from a previous press, or from before
  // the reader came back to this tab. Saying so beats offering the same press twice.
  const showing = showingKey === ownerKey;

  const show = async (): Promise<void> => {
    const requestedIn = regionId;
    setBusy(true);
    setError(null);
    try {
      const { trackIds, partials, bounds } = await load();
      if (!mounted.current || currentRegion.current !== requestedIn) return;
      highlight({ trackIds, kind: "view", partials, ownerKey, bounds });
      router.push("/(tabs)/map");
    } catch (caught) {
      if (!mounted.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load its routes.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-1">
      <Button
        label={showing ? "Showing on the map" : label}
        variant={showing ? "secondary" : "outline"}
        busy={busy}
        onPress={() => {
          if (!showing) return void show();
          refit();
          router.push("/(tabs)/map");
        }}
      />
      {error ? <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text> : null}
    </View>
  );
}
