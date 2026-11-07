"use client";

import { useRef, useState } from "react";
import { actionErrorMessage } from "@/lib/actionResult";
import { useToast } from "@/lib/toast";

/**
 * One save at a time: `run(what, task)` does nothing while an earlier task is in
 * flight, and reports a failure as "Failed to <what>". Resolves whether the task
 * ran and succeeded. `busy` disables the buttons meanwhile.
 *
 * `run(what, task, tag)` also names the task: `running` is the tag of the one in
 * flight (null when idle or untagged), so each button can say what it is doing
 * while `busy` disables them all.
 *
 * The ref is the guard: it is set synchronously, while `busy` only lands on the
 * next render — two clicks in one task both got past the state alone.
 */
export function useSingleFlight<Tag = never>() {
  const { showError } = useToast();
  const busyRef = useRef(false);
  const [inFlight, setInFlight] = useState<{ tag: Tag | null } | null>(null);

  const run = async (what: string, task: () => Promise<void>, tag?: Tag): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setInFlight({ tag: tag ?? null });
    try {
      await task();
      return true;
    } catch (error) {
      console.error(`Failed to ${what}:`, error);
      showError(`Failed to ${what}: ${actionErrorMessage(error)}`);
      return false;
    } finally {
      busyRef.current = false;
      setInFlight(null);
    }
  };

  return { busy: inFlight !== null, running: inFlight?.tag ?? null, run };
}
