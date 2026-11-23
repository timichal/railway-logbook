/**
 * The last rides the server sent (`GET /api/v1/rides`), kept on the device so an
 * offline cold start still draws the map coloured (`useRides`). The route tiles
 * come from MapLibre's disk cache under the kept tile version
 * (`useRoutesTileVersion`); without the rides beside them, the map would hold back
 * every route line until a connection came.
 *
 * **One copy, for one account.** It is stored with the id of the account it
 * belongs to, and read back only for that account, so a different account signed
 * in on the device never draws someone else's colours. It goes with the session
 * (`forgetStoredRides`, from `AuthContext`), as the keychain's copy of the user
 * does: the rides name the user's journeys. An answer still out as the session
 * ends must not write it back, so a write names the session it was read in
 * (`ridesSession`, taken as the request goes out) and is dropped once that is over.
 *
 * In `AsyncStorage`, not SecureStore: it is a cache of what the server shows the
 * user, not a credential, and it is too large for the keychain. Every read and
 * write is a convenience that may fail; the server holds the rides.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RouteRide } from "@shared/map/routeRides";

const STORAGE_KEY = "railwayLogbook.rides";

/** Moves on as each session ends. */
let session = 0;

/** The session a read starts in, to hand to `storeRides` when it answers. */
export function ridesSession(): number {
  return session;
}

interface StoredRides {
  userId: number;
  rides: RouteRide[];
}

function isRide(value: unknown): value is RouteRide {
  if (!value || typeof value !== "object") return false;
  const ride = value as Record<string, unknown>;
  return (
    typeof ride.track_id === "number" &&
    typeof ride.whole === "boolean" &&
    typeof ride.closed === "boolean" &&
    (ride.date === null || typeof ride.date === "string") &&
    (ride.journey_name === null || typeof ride.journey_name === "string")
  );
}

/** The kept rides if they are this account's, else null. Never throws. */
export async function readStoredRides(userId: number): Promise<RouteRide[] | null> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<StoredRides> | null;
    if (parsed?.userId !== userId || !Array.isArray(parsed.rides)) return null;
    // One bad entry and the copy is not trusted: a version of the app that stored
    // another shape, or a write cut short
    return parsed.rides.every(isRide) ? parsed.rides : null;
  } catch {
    return null;
  }
}

/** Replaces whatever was kept, any account's, unless `readIn` has ended since. */
export function storeRides(userId: number, rides: readonly RouteRide[], readIn: number): void {
  if (readIn !== session) return;
  const stored: StoredRides = { userId, rides: [...rides] };
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored)).catch(() => {
    // The next offline cold start draws no routes until a connection, as before
  });
}

/** Called as a session ends. */
export function forgetStoredRides(): void {
  session += 1;
  void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}
