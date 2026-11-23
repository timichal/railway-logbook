/**
 * Name autocomplete: what the map's search box and every planner field ask.
 *
 * The web app's `useSearchCombobox` in all the parts that are not a browser — the same
 * 300ms debounce and the same two-character floor, which is where the server stops
 * answering anyway. What it drops is the keyboard navigation (there is no keyboard to
 * navigate with) and the focus and blur handling, since a native field's results
 * are a list that is either rendered or not.
 *
 * What it adds is the **abort**. On the web every search is a server action and a
 * stale one merely resolves late; here they are HTTP requests over whatever
 * connection a train has, and two in flight can land out of order — so the older one
 * is cancelled rather than allowed to overwrite the newer answer. And a search that
 * fails, or doesn't answer within `READ_TIMEOUT_MS`, says so (`error`) rather than
 * passing for no match: offline, "No stations found" would be a lie about the
 * network.
 *
 * Region-scoped, because the map is locked to its region: a hit anywhere else could
 * not be flown to, and a station in the other region would plan a path the map cannot
 * show. A region switch empties the field for the same reason.
 *
 * `useNameSearch` is the mechanism, over whatever one request answers: the planner's
 * fields want stations (`useStationSearch`), the map's box lines and stations
 * (`MapStationSearch`).
 */
import { MIN_SEARCH_QUERY_LENGTH, SEARCH_DEBOUNCE_MS } from "@shared/constants";
import type { RegionId } from "@shared/regions";
import { searchQueryLength } from "@shared/searchQuery";
import type { Station } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { NetworkError, READ_TIMEOUT_MS } from "@/api/client";
import * as api from "@/api/endpoints";

export interface NameSearch<T> {
  query: string;
  setQuery(value: string): void;
  results: T;
  searching: boolean;
  /** Why the last search has no answer, when it failed rather than found nothing. */
  error: string | null;
  /** Empty the field and the results — after a pick, or on a region switch. */
  reset(): void;
}

export type StationSearch = NameSearch<Station[]>;

/**
 * @param search One request for a query; a module-level function, since a new one
 *   on every render would search again on every render.
 * @param empty What there is before (and instead of) an answer; module-level for the
 *   same reason.
 */
export function useNameSearch<T>(
  regionId: RegionId,
  search: (region: RegionId, query: string, signal: AbortSignal) => Promise<T>,
  empty: T,
): NameSearch<T> {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<T>(empty);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setQuery("");
    setResults(empty);
    setSearching(false);
    setError(null);
  }, [empty]);

  // The results in the field belong to the region that just went off screen.
  const mountedRegion = useRef(regionId);
  useEffect(() => {
    if (mountedRegion.current === regionId) return;
    mountedRegion.current = regionId;
    reset();
  }, [regionId, reset]);

  useEffect(() => {
    if (searchQueryLength(query) < MIN_SEARCH_QUERY_LENGTH) {
      setResults(empty);
      setSearching(false);
      setError(null);
      return;
    }

    setSearching(true);
    const controller = new AbortController();
    // A search that hasn't answered in time is aborted too, but as a failure
    let timedOut = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      deadline = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, READ_TIMEOUT_MS);
      search(regionId, query.trim(), controller.signal)
        .then((found) => {
          setResults(found);
          setError(null);
          setSearching(false);
        })
        .catch((cause: unknown) => {
          // Aborted: a newer search is already on its way and owns the state
          if (controller.signal.aborted && !timedOut) return;
          setResults(empty);
          setError(
            timedOut || cause instanceof NetworkError
              ? "Couldn't search. Check your connection."
              : "Couldn't search. Try again.",
          );
          setSearching(false);
        })
        .finally(() => clearTimeout(deadline));
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      clearTimeout(deadline);
      controller.abort();
    };
  }, [query, regionId, search, empty]);

  return { query, setQuery, results, searching, error, reset };
}

const NO_STATIONS: Station[] = [];

export function useStationSearch(regionId: RegionId): StationSearch {
  return useNameSearch(regionId, api.stations, NO_STATIONS);
}
