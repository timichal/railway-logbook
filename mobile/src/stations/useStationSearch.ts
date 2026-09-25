/**
 * Station-name autocomplete: what the map's search box and every planner field ask.
 *
 * The web app's `useStationSearch` in all the parts that are not a browser — the same
 * 300ms debounce and the same two-character floor, which is where the server stops
 * answering anyway. What it drops is the keyboard navigation (there is no keyboard to
 * navigate with) and the "show/hide suggestions" flag, since a native field's results
 * are a list that is either rendered or not.
 *
 * What it adds is the **abort**. On the web every search is a server action and a
 * stale one merely resolves late; here they are HTTP requests over whatever
 * connection a train has, and two in flight can land out of order — so the older one
 * is cancelled rather than allowed to overwrite the newer answer.
 *
 * Region-scoped, because the map is locked to its region: a hit anywhere else could
 * not be flown to, and a station in the other region would plan a path the map cannot
 * show. A region switch empties the field for the same reason.
 */
import type { RegionId } from "@shared/regions";
import type { Station } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/api/endpoints";

/** Below this the server answers with nothing, so there is no request worth sending. */
const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

export interface StationSearch {
  query: string;
  setQuery(value: string): void;
  results: Station[];
  searching: boolean;
  /** Empty the field and the results — after a pick, or on a region switch. */
  reset(): void;
}

export function useStationSearch(regionId: RegionId): StationSearch {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Station[]>([]);
  const [searching, setSearching] = useState(false);

  const reset = useCallback(() => {
    setQuery("");
    setResults([]);
    setSearching(false);
  }, []);

  // The stations in the field belong to the region that just went off screen.
  const mountedRegion = useRef(regionId);
  useEffect(() => {
    if (mountedRegion.current === regionId) return;
    mountedRegion.current = regionId;
    reset();
  }, [regionId, reset]);

  useEffect(() => {
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .stations(regionId, query.trim(), controller.signal)
        .then((found) => {
          setResults(found);
          setSearching(false);
        })
        .catch(() => {
          // Either the request was aborted — a newer one is already on its way and
          // owns the state — or it failed, which reads the same as no match here.
          if (!controller.signal.aborted) {
            setResults([]);
            setSearching(false);
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, regionId]);

  return { query, setQuery, results, searching, reset };
}
