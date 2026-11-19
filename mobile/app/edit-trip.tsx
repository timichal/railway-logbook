/**
 * A trip's name and description: a new trip with no `id`, an existing one with
 * its `id` and the current values as route params (the logbook card holds them,
 * so nothing is read again to open this).
 *
 * A modal, like the logging screen: spent, not left. A save bumps the log
 * version, which reloads the logbook (and the logging screen's trip list next
 * time it opens). A trip is region-free on the server: a new one with no journeys
 * belongs to every region's list until something is filed under it.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import * as api from "@/api/endpoints";
import { bumpLogVersion } from "@/logbook/logVersion";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { TextField } from "@/ui/TextField";

export default function EditTripScreen(): ReactNode {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; name?: string; description?: string }>();
  const id = params.id ? Number(params.id) : null;
  const [name, setName] = useState(params.name ?? "");
  const [description, setDescription] = useState(params.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (): Promise<void> => {
    if (!name.trim()) {
      setError("Give the trip a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input = { name: name.trim(), description: description.trim() || undefined };
      if (id === null) await api.createTrip(input);
      else await api.updateTrip(id, input);
      bumpLogVersion();
      router.back();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the trip.");
      setSaving(false);
    }
  };

  return (
    <Screen>
      <View className="flex-1">
        <View className="flex-row items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Text className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {id === null ? "New trip" : "Edit trip"}
          </Text>
          <Button label="Cancel" variant="ghost" disabled={saving} onPress={() => router.back()} />
        </View>
        <ScrollView
          contentContainerClassName="gap-4 p-4"
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <TextField
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Summer in the Alps"
            autoFocus={id === null}
            returnKeyType="next"
          />
          <TextField
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="Optional"
            multiline
          />
          {error ? <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text> : null}
          <Button
            label={id === null ? "Create trip" : "Save changes"}
            onPress={() => void submit()}
            busy={saving}
          />
        </ScrollView>
      </View>
    </Screen>
  );
}
