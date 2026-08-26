"use client";
import { btn } from "@/lib/ui/buttonStyles";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  thirdLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onThird?: () => void;
  variant?: "danger" | "warning" | "info";
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  thirdLabel,
  onConfirm,
  onCancel,
  onThird,
  variant = "warning",
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const confirmVariant = { danger: "danger", warning: "warning", info: "primary" } as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-6 whitespace-pre-line">{message}</p>

        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onCancel} className={btn("subtle", "md")}>
            {cancelLabel}
          </button>
          {thirdLabel && onThird && (
            <button type="button" onClick={onThird} className={btn("neutral", "md")}>
              {thirdLabel}
            </button>
          )}
          <button type="button" onClick={onConfirm} className={btn(confirmVariant[variant], "md")}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
