/**
 * Throwing the selection away, from the map's selection bar or the logging screen.
 *
 * It can't be undone, and a selection built from a planner result or many taps is
 * easy to lose to a stray press, so beyond a couple of routes it asks first. One or
 * two routes are quicker to pick again than to confirm.
 */
import { Alert } from "react-native";

const ASK_ABOVE = 2;

export function confirmClearSelection(count: number, clear: () => void): void {
  if (count <= ASK_ABOVE) {
    clear();
    return;
  }
  Alert.alert(`Clear ${count} selected routes?`, "This can't be undone.", [
    { text: "Cancel", style: "cancel" },
    { text: "Clear", style: "destructive", onPress: clear },
  ]);
}

/**
 * Dropping the edit of a saved journey, from the map's bar or the editor. Only an
 * edit that changed something asks; the journey itself is never touched.
 */
export function confirmStopEditing(
  editing: { name: string; changed: boolean } | null,
  stop: () => void,
): void {
  if (!editing?.changed) {
    stop();
    return;
  }
  Alert.alert(`Discard your changes to “${editing.name}”?`, "The journey stays as it was.", [
    { text: "Keep editing", style: "cancel" },
    { text: "Discard", style: "destructive", onPress: stop },
  ]);
}
