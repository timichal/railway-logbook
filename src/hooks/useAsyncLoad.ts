import {
  type DependencyList,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";

export interface AsyncLoad<T> {
  /** The result of the latest load for the current deps; null while loading or after a failure. */
  data: T | null;
  loading: boolean;
  error: Error | null;
  /** Loads again with the same deps, e.g. from a Retry button. Stable. */
  retry: () => void;
  /** Replaces the loaded value (and clears `error`), for a caller that edits what it loaded. Stable. */
  setData: Dispatch<SetStateAction<T | null>>;
}

interface LoadState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

const LOADING = { data: null, loading: true, error: null };

function sameDeps(a: DependencyList, b: DependencyList): boolean {
  return a.length === b.length && a.every((dep, i) => Object.is(dep, b[i]));
}

/**
 * Runs `load` whenever `deps` change and keeps the answer for the latest run only.
 *
 * Every run starts from nothing, and the reset happens *during the render* that
 * sees the new deps rather than in the effect after it — so not even one commit
 * shows the previous account's or region's result under the new ones, and a
 * failed load cannot leave it standing either. A run superseded by a later one
 * (or by unmount) is dropped whole — its result, its failure and its log line
 * alike, since a request nobody is waiting for any more has nothing to report.
 *
 * To load only some of the time (a dialog while open), mount the component that
 * calls this only then. `label` names the load in the console on failure.
 *
 * Deps are checked by Biome as `useEffect`'s are (`hooks` under
 * `useExhaustiveDependencies` in `biome.json`), so `load` is written inline.
 */
export function useAsyncLoad<T>(
  load: () => Promise<T>,
  deps: DependencyList,
  label = "data",
): AsyncLoad<T> {
  const [state, setState] = useState<LoadState<T>>(LOADING);
  // Bumped by retry, to re-run the effect
  const [attempt, setAttempt] = useState(0);

  // The deps the state belongs to: when they change, the state is reset here and
  // React re-renders before committing anything
  const [loadedDeps, setLoadedDeps] = useState(deps);
  if (!sameDeps(loadedDeps, deps)) {
    setLoadedDeps(deps);
    setState(LOADING);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's deps are checked at the call site; attempt is the retry trigger.
  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      },
      (reason: unknown) => {
        if (cancelled) return;
        console.error(`Failed to load ${label}:`, reason);
        const error = reason instanceof Error ? reason : new Error(String(reason));
        setState({ data: null, loading: false, error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [...deps, attempt]);

  const retry = useCallback(() => {
    setState(LOADING);
    setAttempt((n) => n + 1);
  }, []);
  const setData = useCallback<Dispatch<SetStateAction<T | null>>>(
    (value) =>
      setState((s) => ({
        ...s,
        data: typeof value === "function" ? (value as (prev: T | null) => T | null)(s.data) : value,
        error: null,
      })),
    [],
  );

  return { ...state, retry, setData };
}
