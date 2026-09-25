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
 * The write is **optimistic**: the map should redraw on the tap, not on the round
 * trip. A rejected write puts the old list back and says so, rather than leaving the
 * map filtered by something the server never accepted.
 *
 * Keyed on the **session**, not on mount: the provider sits above the auth guard (the
 * map is what reads it, and that is behind the guard), so the read has to wait for a
 * token and has to happen again for the next person to sign in — otherwise the first
 * account's list would be the second account's filter.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import * as api from "@/api/endpoints";
import { useAuth } from "@/auth/AuthContext";

interface CountryPrefsValue {
  /** Null until the preference has arrived — see `useEffectiveCountries`. */
  selectedCountries: string[] | null;
  /** Set when the list could not be read or written; cleared by the next successful write. */
  error: string | null;
  setSelectedCountries(countries: string[]): void;
}

const CountryPrefsContext = createContext<CountryPrefsValue | null>(null);

export function CountryPrefsProvider({ children }: { children: ReactNode }): ReactNode {
  const { status } = useAuth();
  const [selectedCountries, setStored] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "signedIn") {
      // Signed out, or still settling the session from the keychain: there is nobody
      // to have a preference yet, and what is held belongs to whoever just left.
      setStored(null);
      setError(null);
      return;
    }

    let cancelled = false;
    api
      .preferences()
      .then((countries) => !cancelled && setStored(countries))
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not load your countries.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  // Assigned during render and read only from the callback, which is how the callback
  // stays stable while still knowing what it is replacing. The request must not be
  // fired from inside a state updater: an updater is called for its return value and
  // may be called more than once.
  const current = useRef(selectedCountries);
  current.current = selectedCountries;

  const setSelectedCountries = useCallback((countries: string[]) => {
    const rollback = current.current;
    setStored(countries);
    void api.savePreferences(countries).then(
      () => setError(null),
      (caught: unknown) => {
        // Back to what the server still holds — nothing else writes this column.
        setStored(rollback);
        setError(caught instanceof Error ? caught.message : "Could not save your countries.");
      },
    );
  }, []);

  return (
    <CountryPrefsContext.Provider value={{ selectedCountries, error, setSelectedCountries }}>
      {children}
    </CountryPrefsContext.Provider>
  );
}

export function useCountryPrefs(): CountryPrefsValue {
  const value = useContext(CountryPrefsContext);
  if (!value) throw new Error("useCountryPrefs must be used inside a CountryPrefsProvider");
  return value;
}
