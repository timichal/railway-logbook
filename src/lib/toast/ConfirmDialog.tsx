"use client";
import { useId } from "react";
import { btn } from "@/lib/ui/buttonStyles";
import { useModalDialog } from "@/lib/ui/useModalDialog";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  thirdLabel?: string;
  onConfirm: () => void;
  /** Also what Escape does: the cancel button is always the non-committal answer. */
  onCancel: () => void;
  onThird?: () => void;
  variant?: "danger" | "warning" | "info";
}

export function ConfirmDialog({ isOpen, ...props }: ConfirmDialogProps) {
  // Mounted only while open: `useModalDialog` shows the dialog for as long as it is.
  return isOpen ? <ConfirmDialogPanel {...props} /> : null;
}

const CONFIRM_VARIANT = { danger: "danger", warning: "warning", info: "primary" } as const;

function ConfirmDialogPanel({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  thirdLabel,
  onConfirm,
  onCancel,
  onThird,
  variant = "warning",
}: Omit<ConfirmDialogProps, "isOpen">) {
  const dialogRef = useModalDialog(onCancel);
  const titleId = useId();
  const messageId = useId();

  // Focus lands on the first button, Cancel — the safe answer to Enter.
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      className="m-auto w-[calc(100%-2rem)] max-w-md p-6 bg-surface text-fg rounded-lg shadow-xl backdrop:bg-[rgb(0_0_0/0.5)]"
    >
      <h3 id={titleId} className="text-lg font-semibold text-gray-900 mb-2">
        {title}
      </h3>
      <p id={messageId} className="text-sm text-gray-600 mb-6 whitespace-pre-line">
        {message}
      </p>

      <div className="flex gap-3 justify-end">
        <button type="button" onClick={onCancel} className={btn("subtle", "md")}>
          {cancelLabel}
        </button>
        {thirdLabel && onThird && (
          <button type="button" onClick={onThird} className={btn("neutral", "md")}>
            {thirdLabel}
          </button>
        )}
        <button type="button" onClick={onConfirm} className={btn(CONFIRM_VARIANT[variant], "md")}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
