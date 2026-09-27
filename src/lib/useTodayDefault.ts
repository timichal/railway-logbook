"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getTodayDateStr } from "@/lib/shared/getUntimezonedDateStr";

/**
 * A date field that defaults to today and keeps meaning today while untouched.
 *
 * A sidebar left open overnight would otherwise still offer yesterday, and a
 * journey logged without a glance at the field would be saved under it. So when
 * the page comes back into view (or the field is focused), a field the user has
 * not set is moved on to the current day. Once they set it — to today included —
 * it is theirs and never overridden.
 *
 * `reset` puts the field back on an untouched today, as after a save.
 */
export function useTodayDefault() {
  const [value, setStoredValue] = useState(getTodayDateStr);
  const touchedRef = useRef(false);

  const setValue = useCallback((next: string) => {
    touchedRef.current = true;
    setStoredValue(next);
  }, []);

  const reset = useCallback(() => {
    touchedRef.current = false;
    setStoredValue(getTodayDateStr());
  }, []);

  const refresh = useCallback(() => {
    if (!touchedRef.current) setStoredValue(getTodayDateStr());
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  return { value, setValue, reset, refresh };
}
