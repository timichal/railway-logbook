"use client";

import { useEffectEvent, useLayoutEffect, useRef } from "react";

/**
 * Opens a native `<dialog>` as a modal for as long as the calling component is
 * mounted, and reports Escape (or the browser closing it) through `onDismiss`.
 *
 * `showModal()` is what the hand-rolled overlays never had: `role="dialog"` with
 * `aria-modal`, the rest of the page inert (so Tab cannot walk out behind it),
 * initial focus on the first control, focus handed back to whatever held it on
 * close, and Escape going to the topmost dialog only — a confirm opened over the
 * menu closes itself, not the menu underneath.
 *
 * Mount the component only while it should be open. The dialog is shown in a
 * layout effect, before the first paint, so it never renders in flow; its
 * `display` should therefore come from an `open:` variant or be left to the UA.
 * React state stays the owner: Escape is cancelled and handed to `onDismiss`,
 * and the dialog closes when the caller unmounts it. Closing it there, in the
 * layout cleanup while the node is still attached, is what restores focus —
 * a dialog merely removed from the document hands focus back to nobody.
 */
export function useModalDialog(onDismiss: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const dismiss = useEffectEvent(onDismiss);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();

    // Chrome does not always let a page cancel Escape: without user activation
    // since the dialog opened, `cancel` arrives not cancelable and the dialog shuts
    // regardless — and Chrome 153 was seen firing no `close` after it at all. So a
    // `cancel` dismisses either way; the cancelable one is held open for React to
    // close, and is reported as often as the caller keeps the dialog open. Only the
    // browser's own close is remembered, so a `close` after it is not a second one.
    let closedByBrowser = false;
    const onCancel = (event: Event) => {
      if (event.cancelable) event.preventDefault();
      else closedByBrowser = true;
      dismiss();
    };
    // Anything else that shuts it (a `<form method="dialog">`, say). `close` is
    // queued as a task, so one from a previous mount can arrive after a remount
    // (Strict Mode) — hence the `open` check: only a dialog that is shut dismisses.
    const onClose = () => {
      if (!dialog.open && !closedByBrowser) dismiss();
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClose);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close();
    };
  }, []);

  return ref;
}
