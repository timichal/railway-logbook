/**
 * Logging the selection as a journey — the web app's Route Logger, minus the map
 * that is already behind this screen — and, while a saved journey is being edited
 * (`SelectionContext`'s `editing`), that journey's editor.
 *
 * Presented as a modal over the tabs rather than as a fourth tab: it exists only
 * while there is something to spend. **Closing it keeps everything**: the form and
 * the routes are the selection context's, so going back to the map to pick another
 * route loses nothing. A new journey's draft ends when it is logged; an edit's when
 * it is saved, deleted or dropped ("Stop editing").
 *
 * The form is the web app's: a required name, a required date defaulting to today,
 * an optional description, and an optional trip to file it under. The trip list is
 * region-scoped for the reason `API.md` gives — a journey is logged on one region's
 * map, so offering the other continent's trips only invites a misfile.
 *
 * An edit's Save sends only what changed (`journeyEditsToSave`), in one request the
 * server applies all or nothing. Saving a journey with no routes left offers to
 * delete it instead, as the web does.
 *
 * **The date is typed, not picked.** A native date picker is another native module
 * and therefore another development build; the two buttons beside the field cover
 * the case that actually happens (a ride logged the same day or the next), and the
 * field takes anything else. See `MOBILE_APP_PLAN.md`.
 */

import { formatDateOnly, isDateOnly } from "@shared/getUntimezonedDateStr";
import { routeTitle } from "@shared/map/routeFeature";
import { useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import * as api from "@/api/endpoints";
import { confirmClearSelection, confirmStopEditing } from "@/logbook/confirmClearSelection";
import { journeyEditsToSave, loggedRouteInput } from "@/logbook/journeyEdit";
import { bumpLogVersion } from "@/logbook/logVersion";
import {
  dateOffsetFromToday,
  loggedLengthKm,
  type SelectedRoute,
  useSelection,
} from "@/logbook/SelectionContext";
import { useRegion } from "@/region/RegionContext";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { TextField } from "@/ui/TextField";

export default function LogJourneyScreen(): ReactNode {
  const router = useRouter();
  const { regionId } = useRegion();
  const { selected, form, editing, updateForm, remove, clear, resetNew, freshenDate, endEdit } =
    useSelection();

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

  // The draft can be days old by now: a date never chosen means today, not then
  useEffect(() => freshenDate(), [freshenDate]);

  // Once: ending an edit puts the new journey's draft in front, whose empty
  // selection would close the screen a second time
  const closing = useRef(false);
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/map");
  }, [router]);

  // Spending the last route of a new journey ends the screen: there is nothing
  // left to log. An edit stays open with none, to add some or delete the journey.
  useEffect(() => {
    if (!editing && selected.length === 0) close();
  }, [editing, selected.length, close]);

  const dateValid = isDateOnly(form.date);

  const run = useCallback(async (action: () => Promise<void>, failure: string): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      // The draft stays, whatever went wrong: an edit worth retrying or changing
      setError(caught instanceof Error ? caught.message : failure);
      setSaving(false);
    }
  }, []);

  const submit = (): void => {
    if (!form.name.trim()) {
      setError("Give the journey a name.");
      return;
    }
    if (!dateValid) {
      setError("The date must be a real day, as YYYY-MM-DD.");
      return;
    }

    if (!editing) {
      void run(async () => {
        await api.createJourney({
          name: form.name.trim(),
          date: form.date,
          description: form.description.trim() || undefined,
          tripId: form.tripId ?? undefined,
          routes: selected.map(loggedRouteInput),
        });
        // The version bump is what repaints the route in its new colour and reloads
        // the numbers over it. Emptying the selection is what closes this screen
        // (the effect above).
        bumpLogVersion();
        resetNew();
      }, "Could not log the journey.");
      return;
    }

    const { journeyId, base } = editing;
    const deleteIt = () =>
      void run(async () => {
        await api.deleteJourney(journeyId);
        bumpLogVersion();
        close();
        endEdit();
      }, "Could not delete the journey.");

    // A journey with no routes left is one to delete, not keep
    if (selected.length === 0) {
      Alert.alert(
        "Delete this journey?",
        `“${base.form.name}” has no routes left. Delete the journey, or keep editing to add some?`,
        [
          { text: "Keep editing", style: "cancel" },
          { text: "Delete journey", style: "destructive", onPress: deleteIt },
        ],
      );
      return;
    }

    void run(async () => {
      await api.updateJourney(journeyId, journeyEditsToSave(base, form, selected));
      bumpLogVersion();
      close();
      endEdit();
    }, "Could not save the journey.");
  };

  const stopEditing = (): void =>
    confirmStopEditing(editing, () => {
      close();
      endEdit();
    });

  // The trip it is filed under, though the list doesn't have it (another region's):
  // shown rather than read as None
  const tripOptions =
    trips && form.tripId !== null && !trips.some((trip) => trip.id === form.tripId)
      ? [...trips, { id: form.tripId, name: "Current trip" }]
      : trips;

  return (
    <Screen>
      {/* Not a KeyboardAvoidingView: it measures itself against its parent, not the
          screen, and a modal sheet starts below the top of the screen — so it came up
          short by that much, and the keyboard's suggestion bar covered the bottom of
          the form. The scroll view's own iOS inset is measured by UIKit in window
          coordinates; Android resizes the window for the keyboard itself. */}
      <View className="flex-1">
        <View className="flex-row items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Text
            className="flex-1 text-lg font-bold text-gray-900 dark:text-gray-100"
            numberOfLines={1}
          >
            {editing ? `Edit “${editing.name}”` : "Log journey"}
          </Text>
          {/* Keeps the draft: it is how the reader goes back to the map for more */}
          {/* Not while saving: a failure is shown here, and nowhere else */}
          <Button label="Close" variant="ghost" disabled={saving} onPress={close} />
        </View>

        <ScrollView
          contentContainerClassName="gap-6 p-4"
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View className="gap-3">
            <TextField
              label="Name"
              value={form.name}
              onChangeText={(name) => updateForm({ name })}
              placeholder="Weekend trip to Vienna"
              autoFocus={!editing && form.name === ""}
              returnKeyType="next"
            />
            <View className="gap-1.5">
              <TextField
                label="Date"
                value={form.date}
                onChangeText={(date) => updateForm({ date })}
                placeholder="YYYY-MM-DD"
                autoCapitalize="none"
                autoCorrect={false}
                // The day as the phone writes dates, so a typo in the digits shows
                hint={dateValid ? formatDateOnly(form.date) : undefined}
                // Not while it is still being typed
                error={form.date.length >= 10 && !dateValid ? "Not a real day: YYYY-MM-DD" : null}
              />
              <View className="flex-row gap-2">
                <Button
                  label="Today"
                  variant="outline"
                  className="flex-1"
                  onPress={() => updateForm({ date: dateOffsetFromToday(0) })}
                />
                <Button
                  label="Yesterday"
                  variant="outline"
                  className="flex-1"
                  onPress={() => updateForm({ date: dateOffsetFromToday(1) })}
                />
              </View>
            </View>
            <TextField
              label="Description"
              value={form.description}
              onChangeText={(description) => updateForm({ description })}
              placeholder="Optional"
              multiline
            />
          </View>

          <TripPicker
            trips={tripOptions}
            value={form.tripId}
            onChange={(tripId) => updateForm({ tripId })}
          />

          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {selected.length} {selected.length === 1 ? "route" : "routes"}
              </Text>
              {editing ? (
                // Reached from the logbook, so the map is not what closing returns to
                <Button
                  label="Add on the map"
                  variant="ghost"
                  disabled={saving}
                  onPress={() => {
                    // Off the modal, then to the map tab under it
                    close();
                    router.navigate("/(tabs)/map");
                  }}
                />
              ) : (
                // Emptying the selection closes the screen (the effect above), as the
                // map bar's clear button does.
                <Button
                  label="Clear selection"
                  variant="ghost"
                  disabled={saving}
                  onPress={() => confirmClearSelection(selected.length, clear)}
                />
              )}
            </View>
            {editing && selected.length === 0 ? (
              <Text className="text-sm text-gray-600 dark:text-gray-400">
                No routes left. Add some on the map, or save to delete the journey.
              </Text>
            ) : null}
            {selected.map((entry) => (
              <RouteRow
                key={entry.route.trackId}
                entry={entry}
                regionId={regionId}
                saving={saving}
                onRemove={() => remove(entry.route.trackId)}
              />
            ))}
          </View>

          {error ? <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text> : null}

          {editing ? (
            <View className="gap-2">
              <Button
                label="Save changes"
                onPress={submit}
                busy={saving}
                disabled={!editing.changed}
              />
              {!editing.changed && !saving ? (
                <Text className="text-center text-xs text-gray-500 dark:text-gray-400">
                  Nothing changed yet
                </Text>
              ) : null}
              <Button
                label="Stop editing"
                variant="ghost"
                disabled={saving}
                onPress={stopEditing}
              />
            </View>
          ) : (
            <Button label="Log journey" onPress={submit} busy={saving} />
          )}
        </ScrollView>
      </View>
    </Screen>
  );
}

function RouteRow({
  entry,
  regionId,
  saving,
  onRemove,
}: {
  entry: SelectedRoute;
  regionId: Parameters<typeof routeTitle>[1];
  /** While the journey is being sent: what is sent is already fixed. */
  saving: boolean;
  onRemove(): void;
}): ReactNode {
  const { name, endpoints } = routeTitle(entry.route, regionId);

  return (
    <View className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
      <View className="flex-row items-start gap-2">
        <View className="flex-1">
          {name ? (
            <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100">{name}</Text>
          ) : null}
          <Text className="text-sm text-gray-900 dark:text-gray-100">{endpoints}</Text>
          {/* A partial ride comes from the planner, with the stretch it measured, as
              the web's Route Logger shows it */}
          <Text className="text-xs text-gray-600 dark:text-gray-400">
            {loggedLengthKm(entry).toFixed(1)} km
            {entry.partial && entry.covered ? (
              <Text className="text-amber-700 dark:text-amber-400">
                {` of ${entry.route.lengthKm.toFixed(1)}`}
              </Text>
            ) : null}
          </Text>
        </View>
        <Button label="Remove" variant="ghost" disabled={saving} onPress={onRemove} />
      </View>
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
  trips: { id: number; name: string }[] | null;
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
