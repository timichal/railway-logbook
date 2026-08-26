import { useCallback, useEffect, useRef, useState } from "react";

const FLUSH_INTERVAL_MS = 500;

export interface FrameRate {
  /** Frames per second over the last window, or null before the first window. */
  fps: number | null;
  /** Lowest window average seen since the counter was last reset. */
  minFps: number | null;
  /** Pass to `<Map onDidFinishRenderingFrame>`. */
  onFrame: () => void;
  reset: () => void;
}

/**
 * Counts frames the native map completed, via `onDidFinishRenderingFrame`.
 *
 * **This measurement perturbs what it measures.** Every frame crosses the RN
 * bridge as an event, so the counter itself costs something — which is why the
 * spike can turn it off, and why the honest test is "does it *feel* smooth with
 * the meter off" cross-checked against "what number does the meter say".
 *
 * Frames are tallied in a ref and flushed to state on a timer rather than
 * setState-ing per frame, which would re-render the tree 60 times a second and
 * make the number a measurement of React instead of of the map.
 */
export function useFrameRate(enabled: boolean): FrameRate {
  const frames = useRef(0);
  const [fps, setFps] = useState<number | null>(null);
  const [minFps, setMinFps] = useState<number | null>(null);

  const onFrame = useCallback(() => {
    frames.current += 1;
  }, []);

  const reset = useCallback(() => {
    frames.current = 0;
    setFps(null);
    setMinFps(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setFps(null);
      setMinFps(null);
      return;
    }
    frames.current = 0;
    let last = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - last;
      const counted = frames.current;
      frames.current = 0;
      last = now;
      if (elapsed <= 0) return;
      const value = Math.round((counted * 1000) / elapsed);
      setFps(value);
      // An idle map renders no frames at all, so a 0 says "nothing was moving",
      // not "it stalled". Only windows with actual rendering count toward the low
      // watermark, or the minimum would read 0 the moment you stopped panning.
      if (value > 0) setMinFps((prev) => (prev === null ? value : Math.min(prev, value)));
    }, FLUSH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled]);

  return { fps, minFps, onFrame, reset };
}
