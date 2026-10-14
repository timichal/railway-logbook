/**
 * The user's country filter — `user_preferences.selected_countries`, held once for
 * the whole app.
 *
 * A context rather than a fetch per screen, because two screens read it and one of
 * them writes it: the map turns it into the route tile's `selected_countries`
 * parameter and into the numbers over the corner, and the Countries screen is a tab
 * away changing it. Two hooks each fetching on mount would leave the map showing the
 * old set until something remounted it.
 *
 * **One list across both regions**, as on the web: the column is not region-scoped,
 * and what a region does with it is `useEffectiveCountries`' business — a region with
 * a single country ignores the list and pins the filter to its own.
 *
 * **A copy is kept on the device**, per account, and drawn from at once: the map
 * cannot draw a route without the list, and this app is meant to be opened on a train
 * with no signal. The server's answer replaces it when it comes; a read that fails
 * with nothing on the device is `loadError`, retried by `retry` and on the next
 * return to the foreground.
 *
 * Read and write errors are **kept apart**. A failed save is undone and reported on
 * the screen that made it (`saveError`); the list is still a good list, and the map
 * carries on drawing it. Only a list that could not be had at all blocks the map.
 *
 * The write is **optimistic**: the map should redraw on the tap, not on the round
 * trip. Writes are **sent one at a time, latest wins** — a tap made while one is in
 * flight waits, and a third tap replaces the second rather than queueing behind it.
 * Sent in parallel, two requests could land in either order and leave the server
 * holding a list the screen does not show. A failure with nothing newer waiting puts
 * back the last list the server confirmed; with something newer waiting, that is sent
 * instead, and it is what decides.
 *
 * Keyed on the **session**, not on mount: the provider sits above the auth guard (the
 * map is what reads it, and that is behind the guard), so the read has to wait for a
 * token and has to happen again for the next person to sign in — otherwise the first
 * account's list would be the second account's filter. A write still in flight when
 * the session changes is dropped on landing.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import * as api from "@/api/endpoints";
import { useAuth } from "@/auth/AuthContext";
import { useOnForeground } from "@/lifecycle/useOnForeground";

interface CountryPrefsValue {
  /** Null until the preference has arrived — see `useEffectiveCountries`. */
  selectedCountries: string[] | null;
  /** The list could not be read and there is none on the device. `retry` asks again. */
  loadError: string | null;
  /** The last change could not be saved and was undone. Cleared by the next save that lands. */
  saveError: string | null;
  setSelectedCountries(countries: string[]): void;
  retry(): void;
}

const CountryPrefsContext = createContext<CountryPrefsValue | null>(null);

const cacheKey = (userId: number) => `railwayLogbook.countries.${userId}`;

async function readCached(userId: number): Promise<string[] | null> {
  try {
    const stored = await AsyncStorage.getItem(cacheKey(userId));
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) && parsed.every((code) => typeof code === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function writeCached(userId: number, countries: string[]): void {
  void AsyncStorage.setItem(cacheKey(userId), JSON.stringify(countries)).catch(() => {
    // The device copy is a convenience; the server holds the list.
  });
}

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

export function CountryPrefsProvider({ children }: { children: ReactNode }): ReactNode {
  const { status, user } = useAuth();
  const userId = status === "signedIn" ? (user?.id ?? null) : null;

  const [selectedCountries, setStored] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attempt, retry] = useReducer((n: number) => n + 1, 0);

  // The bookkeeping lives in refs: it is read from callbacks and from requests that
  // land later, and none of it is drawn. A request must not be fired from inside a
  // state updater either — an updater is called for its return value, maybe twice.
  /** Bumped per session; anything that lands for an older one is dropped. */
  const session = useRef(0);
  /** The account the current session is for — where the device copy is written. */
  const sessionUser = useRef<number | null>(null);
  /** The last list the server confirmed, or failing that the device's copy. */
  const confirmed = useRef<string[] | null>(null);
  /** Whether the server has answered this session, by a read or a write. */
  const heard = useRef(false);
  /** Changed by the user this session — a read landing late must not undo that. */
  const touched = useRef(false);
  /** A save has landed this session: the server's state is known from it, not a read. */
  const saved = useRef(false);
  /** The newest list not yet sent, and whether a send is under way. */
  const queued = useRef<string[] | null>(null);
  const sending = useRef(false);

  // A new session: forget the old one's list and drop whatever it still has in flight.
  useEffect(() => {
    // Signed out: the device copy goes with the session, as the keychain's does.
    const previous = sessionUser.current;
    if (previous !== null && userId === null) {
      void AsyncStorage.removeItem(cacheKey(previous)).catch(() => {});
    }
    session.current += 1;
    sessionUser.current = userId;
    confirmed.current = null;
    heard.current = false;
    touched.current = false;
    saved.current = false;
    queued.current = null;
    sending.current = false;
    setStored(null);
    setLoadError(null);
    setSaveError(null);
    if (userId === null) return;

    const own = session.current;
    void readCached(userId).then((cached) => {
      if (own !== session.current || !cached || heard.current || touched.current) return;
      confirmed.current = cached;
      setStored(cached);
    });
  }, [userId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is an intentional trigger — Retry and a return to the foreground ask again.
  useEffect(() => {
    if (userId === null) return;
    const own = session.current;
    let cancelled = false;
    api
      .preferences()
      .then((countries) => {
        if (cancelled || own !== session.current) return;
        setLoadError(null);
        // A save has landed this session, and says more about the server than a read
        // that may have been answered before it.
        if (saved.current) return;
        // A change made before this landed is on its way to the server and wins. This
        // answer is the server's state until that save says otherwise.
        if (sending.current || queued.current !== null) {
          confirmed.current = countries;
          heard.current = true;
          return;
        }
        // Otherwise — nothing changed, or a change that failed and was undone — the
        // read is what there is.
        heard.current = true;
        confirmed.current = countries;
        writeCached(userId, countries);
        setStored(countries);
      })
      .catch((caught: unknown) => {
        if (cancelled || own !== session.current) return;
        // With the device's copy, or a list the user has since picked, the map has
        // something to draw; only with neither is it stuck.
        if (confirmed.current === null && !touched.current) {
          setLoadError(messageOf(caught, "Could not load your countries."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  // Back from the background without ever having heard from the server this session:
  // the connection may be back.
  useOnForeground(() => {
    if (sessionUser.current !== null && !heard.current) retry();
  });

  const flush = useCallback(async (): Promise<void> => {
    const own = session.current;
    sending.current = true;
    while (queued.current !== null) {
      const list = queued.current;
      queued.current = null;
      try {
        await api.savePreferences(list);
        if (own !== session.current) return;
        heard.current = true;
        saved.current = true;
        confirmed.current = list;
        if (sessionUser.current !== null) writeCached(sessionUser.current, list);
        if (queued.current === null) setSaveError(null);
      } catch (caught) {
        if (own !== session.current) return;
        // Something newer is waiting: it supersedes this one and is sent next.
        if (queued.current !== null) continue;
        setStored(confirmed.current);
        setSaveError(messageOf(caught, "Could not save your countries."));
      }
    }
    sending.current = false;
  }, []);

  const setSelectedCountries = useCallback(
    (countries: string[]) => {
      touched.current = true;
      setStored(countries);
      setLoadError(null);
      queued.current = countries;
      if (!sending.current) void flush();
    },
    [flush],
  );

  return (
    <CountryPrefsContext.Provider
      value={{ selectedCountries, loadError, saveError, setSelectedCountries, retry }}
    >
      {children}
    </CountryPrefsContext.Provider>
  );
}

export function useCountryPrefs(): CountryPrefsValue {
  const value = useContext(CountryPrefsContext);
  if (!value) throw new Error("useCountryPrefs must be used inside a CountryPrefsProvider");
  return value;
}
