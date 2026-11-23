/**
 * Where the device is, for the map's locate button (`LocateButton`).
 *
 * **Asked for only when the button is pressed.** The map never prompts by itself: a
 * railway logbook that wants your location the moment it opens has not said why. Once
 * the reader has pressed it and allowed it, the dot stays on the map from then on
 * (`SHOW_KEY`), which is the habit of every map app; turning access off in the
 * system's settings takes it away again on the next launch.
 *
 * Asking is per platform (`locationAccess.ts`, `locationAccess.android.ts`).
 *
 * **One fix, not a follow.** The button flies to where you are and leaves the camera
 * there; the dot moves on its own. MapLibre's tracking mode would fight every other
 * camera move this map makes (fits, the region switch, a station picked in the search).
 */
import { type GeolocationPosition, LocationManager } from "@maplibre/maplibre-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { hasLocationAccess } from "@/map/locationAccess";

export { requestLocationAccess } from "@/map/locationAccess";

const SHOW_KEY = "railwayLogbook.showLocation";

/** How long a press waits for a fix before it says there is none. */
const FIX_TIMEOUT_MS = 10_000;
/**
 * How much older than the press a fix may be. The device's own cached fix, handed
 * over the moment it starts looking, is usually seconds old; one older is from an
 * earlier session, possibly hours and a train ride ago.
 */
const FIX_MAX_AGE_MS = 15_000;

/** iOS stamps a fix in seconds, Android in milliseconds. */
function timestampMs(timestamp: number): number {
  return timestamp < 1e11 ? timestamp * 1000 : timestamp;
}

/**
 * Whether the dot should be on the map at launch: the reader turned it on, and access
 * is still allowed. Never a dialog: a reader who turned it on has decided.
 */
export async function locationShownAtLaunch(): Promise<boolean> {
  try {
    if ((await AsyncStorage.getItem(SHOW_KEY)) !== "1") return false;
    const allowed = await hasLocationAccess();
    if (!allowed) void AsyncStorage.removeItem(SHOW_KEY).catch(() => {});
    return allowed;
  } catch {
    return false;
  }
}

export function rememberLocationShown(): void {
  void AsyncStorage.setItem(SHOW_KEY, "1").catch(() => {
    // The dot comes back with the next press instead
  });
}

/**
 * The next fresh fix the device reports, or null if none comes in time (no signal
 * indoors, location services off altogether).
 *
 * The binding hands a new listener the last fix it kept, from whenever it last
 * looked, so a fix is taken only if it is recent (`FIX_MAX_AGE_MS`). And on iOS a
 * compass reading before the first fix arrives as an update with no location at all.
 */
export function nextLocationFix(): Promise<[number, number] | null> {
  const askedAt = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (lngLat: [number, number] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      LocationManager.removeListener(listener);
      resolve(lngLat);
    };
    const listener = (position: GeolocationPosition | null | undefined) => {
      if (!position?.coords) return;
      if (timestampMs(position.timestamp) < askedAt - FIX_MAX_AGE_MS) return;
      finish([position.coords.longitude, position.coords.latitude]);
    };
    const timer = setTimeout(() => finish(null), FIX_TIMEOUT_MS);
    LocationManager.addListener(listener);
  });
}
