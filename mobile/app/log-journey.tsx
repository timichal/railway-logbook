/**
 * Logging the selection as a journey — the web app's Route Logger, minus the map
 * that is already behind this screen.
 *
 * Presented as a modal over the tabs rather than as a fourth tab: it exists only
 * while there is a selection to spend, and it ends by emptying it.
 *
 * The form is the web app's: a required name, a required date defaulting to today,
 * an optional description, and an optional trip to file it under. The trip list is
 * region-scoped for the reason `API.md` gives — a journey is logged on one region's
 * map, so offering the other continent's trips only invites a misfile.
 *
 * **The date is typed, not picked.** A native date picker is another native module
 * and therefore another development build; the two buttons beside the field cover
 * the case that actually happens (a ride logged the same day or the next), and the
 * field takes anything else. See `MOBILE_APP_PLAN.md`.
 */

import { getUntimezonedDateStr } from "@shared/getUntimezonedDateStr";
import { routeTitle } from "@shared/map/routeFeature";
import { useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import * as api from "@/api/endpoints";
import { bumpLogVersion } from "@/logbook/logVersion";
import { type SelectedRoute, useSelection } from "@/logbook/SelectionContext";
import { useRegion } from "@/region/RegionContext";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { TextField } from "@/ui/TextField";
import { ToggleSwitch } from "@/ui/ToggleSwitch";

/** `YYYY-MM-DD`, `days` before today, in the phone's own timezone. */
function dateOffsetFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return getUntimezonedDateStr(date);
}

export default function LogJourneyScreen(): ReactNode {
  const router = useRouter();
  const { regionId } = useRegion();
  const { selected, remove, setPartial, clear } = useSelection();

  const [name, setName] = useState("");
  const [date, setDate] = useState(() => dateOffsetFromToday(0));
  const [description, setDescription] = useState("");
  const [tripId, setTripId] = useState<number | null>(null);
  const [trips, setTrips] = useState<api.TripWithStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .trips(regionId)
      // A trip is optional, so a list that fails to load is not an error worth
      // blocking the form with — it just means this journey stands on its own.
      .then((list) => !cancelled && setTrips(list))
      .catch(() => !cancelled && setTrips([]));
    return () => {
      cancelled = true;
    };
  }, [regionId]);

  // Spending the last route ends the screen: there is nothing left to log, and
  // leaving an empty form up only invites a request the server would reject.
  useEffect(() => {
    if (selected.length === 0) router.back();
  }, [selected.length, router]);

  const submit = useCallback(async (): Promise<void> => {
    if (!name.trim()) {
      setError("Give the journey a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createJourney({
        name: name.trim(),
        date,
        description: description.trim() || undefined,
        tripId: tripId ?? undefined,
        routes: selected.map((s) => ({
          trackId: s.route.trackId,
          partial: s.partial,
          // Dropped by the server unless `partial` is set, but not sent at all when
          // the extent is unknown — a route ticked by hand says a piece was ridden
          // without saying which.
          covered:
            s.partial && s.covered
              ? { covered_start: s.covered.covered_start, covered_end: s.covered.covered_end }
              : undefined,
        })),
      });
      // Cleared before leaving, so the map behind is already showing the result —
      // and the version bump is what repaints the route in its new colour and
      // reloads the numbers over it.
      bumpLogVersion();
      clear();
      router.back();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not log the journey.");
      setSaving(false);
    }
  }, [name, date, description, tripId, selected, clear, router]);

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <View className="flex-row items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Text className="text-lg font-bold text-gray-900 dark:text-gray-100">Log journey</Text>
          <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
        </View>

        <ScrollView contentContainerClassName="gap-6 p-4" keyboardShouldPersistTaps="handled">
          <View className="gap-3">
            <TextField
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="Weekend trip to Vienna"
              autoFocus
              returnKeyType="next"
            />
            <View className="gap-1.5">
              <TextField
                label="Date"
                value={date}
                onChangeText={setDate}
                placeholder="YYYY-MM-DD"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View className="flex-row gap-2">
                <Button
                  label="Today"
                  variant="outline"
                  className="flex-1"
                  onPress={() => setDate(dateOffsetFromToday(0))}
                />
                <Button
                  label="Yesterday"
                  variant="outline"
                  className="flex-1"
                  onPress={() => setDate(dateOffsetFromToday(1))}
                />
              </View>
            </View>
            <TextField
              label="Description"
              value={description}
              onChangeText={setDescription}
              placeholder="Optional"
              multiline
            />
          </View>

          <TripPicker trips={trips} value={tripId} onChange={setTripId} />

          <View className="gap-2">
            <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {selected.length} {selected.length === 1 ? "route" : "routes"}
            </Text>
            {selected.map((entry) => (
              <RouteRow
                key={entry.route.trackId}
                entry={entry}
                regionId={regionId}
                onRemove={() => remove(entry.route.trackId)}
                onPartial={(partial) => setPartial(entry.route.trackId, partial)}
              />
            ))}
          </View>

          {error ? <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text> : null}

          <Button label="Log journey" onPress={() => void submit()} busy={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function RouteRow({
  entry,
  regionId,
  onRemove,
  onPartial,
}: {
  entry: SelectedRoute;
  regionId: Parameters<typeof routeTitle>[1];
  onRemove(): void;
  onPartial(partial: boolean): void;
}): ReactNode {
  const { name, endpoints } = routeTitle(entry.route, regionId);

  return (
    <View className="gap-1 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
      <View className="flex-row items-start gap-2">
        <View className="flex-1">
          {name ? (
            <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100">{name}</Text>
          ) : null}
          <Text className="text-sm text-gray-900 dark:text-gray-100">{endpoints}</Text>
          <Text className="text-xs text-gray-600 dark:text-gray-400">
            {entry.route.lengthKm.toFixed(1)} km
            {/* A stretch the planner attached says which part; one ticked by hand
                does not, and the row should not pretend otherwise. */}
            {entry.partial && entry.covered ? " · part of the line" : ""}
          </Text>
        </View>
        <Button label="Remove" variant="ghost" onPress={onRemove} />
      </View>
      <ToggleSwitch label="Rode only part of it" value={entry.partial} onChange={onPartial} />
    </View>
  );
}

/**
 * Which trip this journey is filed under, if any. A plain list rather than a native
 * picker: there are rarely many, and a list says what the options are without a tap.
 */
function TripPicker({
  trips,
  value,
  onChange,
}: {
  trips: api.TripWithStats[] | null;
  value: number | null;
  onChange(id: number | null): void;
}): ReactNode {
  if (trips === null) {
    return (
      <View className="items-start">
        <ActivityIndicator />
      </View>
    );
  }
  if (trips.length === 0) return null;

  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">Part of a trip</Text>
      <View className="flex-row flex-wrap gap-2">
        <Button
          label="None"
          variant={value === null ? "primary" : "outline"}
          onPress={() => onChange(null)}
        />
        {trips.map((trip) => (
          <Button
            key={trip.id}
            label={trip.name}
            variant={value === trip.id ? "primary" : "outline"}
            onPress={() => onChange(trip.id)}
          />
        ))}
      </View>
    </View>
  );
}
