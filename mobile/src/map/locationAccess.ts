/**
 * Location access on iOS; Android's is `locationAccess.android.ts`, which Metro picks
 * by its suffix.
 *
 * **The check is `expo-location`'s, and only the check.** The binding has no way to
 * read the status without asking: its request shows the system's dialog whenever
 * nothing is decided — which is the state iOS returns to on the next launch after
 * "Allow Once". Asking stays the binding's, since it is the binding that then looks.
 */
import { LocationManager } from "@maplibre/maplibre-react-native";
import { getForegroundPermissionsAsync } from "expo-location";

/** Asks for access, which is a system dialog only while nothing is decided. */
export function requestLocationAccess(): Promise<boolean> {
  return LocationManager.requestPermissions();
}

/** Whether access is allowed, never with a dialog. */
export async function hasLocationAccess(): Promise<boolean> {
  return (await getForegroundPermissionsAsync()).granted;
}
