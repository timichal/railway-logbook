/**
 * Location access on Android (iOS: `locationAccess.ts`).
 *
 * **"Approximate" counts as allowed.** The binding's own `requestPermissions` wants
 * fine *and* coarse location, so a reader who picks "approximate" in Android's dialog
 * would be told access is off. The native puck and the location engine take either
 * (`PermissionsManager.areLocationPermissionsGranted`), and approximate is plenty to
 * find which line you are on.
 */
import { type Permission, PermissionsAndroid } from "react-native";

const COARSE = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION as Permission;
const FINE = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION as Permission;

/**
 * Asks for access: a system dialog until "don't ask again" is set. Not asked again
 * where approximate is already allowed — the request would offer the upgrade to
 * precise on every press, until refused twice.
 */
export async function requestLocationAccess(): Promise<boolean> {
  if (await PermissionsAndroid.check(COARSE)) return true;
  const result = await PermissionsAndroid.requestMultiple([FINE, COARSE]);
  return result[COARSE] === PermissionsAndroid.RESULTS.GRANTED;
}

/** Whether access is allowed, never with a dialog. */
export function hasLocationAccess(): Promise<boolean> {
  return PermissionsAndroid.check(COARSE);
}
