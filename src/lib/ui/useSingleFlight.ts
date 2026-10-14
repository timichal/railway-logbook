"use client";

import { useRef, useState } from "react";
import { actionErrorMessage } from "@/lib/actionResult";
import { useToast } from "@/lib/toast";

/**
 * One save at a time: `run(what, task)` does nothing while an earlier task is in
 * flight, and reports a failure as "Failed to <what>". Resolves whether the task
 * ran and succeeded. `busy` disables the buttons meanwhile.
 *
 * The ref is the guard: it is set synchronously, while `busy` only lands on the
 * next render — two clicks in one task both got past the state alone.
 */
export function useSingleFlight() {
  const { showError } = useToast();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = async (what: string, task: () => Promise<void>): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      await task();
      return true;
    } catch (error) {
      console.error(`Failed to ${what}:`, error);
      showError(`Failed to ${what}: ${actionErrorMessage(error)}`);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return { busy, run };
}
