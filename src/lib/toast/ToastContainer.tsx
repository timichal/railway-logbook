"use client";

import Icon, { type IconName } from "@/components/ui/Icon";
import IconButton from "@/components/ui/IconButton";
import { useToast } from "./ToastContext";
import type { Toast, ToastType } from "./types";

/**
 * The border is a step deeper than the fill, which is what `*-700` is in the light
 * palette — in the dark one it is the *text* colour drawn on a tint, so it flips
 * light and would ring each toast in a bright outline. `dark:` puts a shadow back
 * in its place; the fills are 400–600 steps and the flip leaves those alone.
 */
const toastStyles: Record<ToastType, string> = {
  success: "bg-green-600 border-green-700 dark:border-black/30",
  error: "bg-red-600 border-red-700 dark:border-black/30",
  warning: "bg-orange-600 border-orange-700 dark:border-black/30",
  info: "bg-blue-600 border-blue-700 dark:border-black/30",
};

const toastIcons: Record<ToastType, IconName> = {
  success: "check",
  error: "close",
  warning: "warning",
  info: "info",
};

function ToastItem({ toast }: { toast: Toast }) {
  const { removeToast } = useToast();
  const styles = toastStyles[toast.type];
  const icon = toastIcons[toast.type];

  return (
    <div
      className={`${styles} text-white px-4 py-3 rounded-md shadow-lg border flex items-center gap-3 min-w-0 md:min-w-[300px] max-w-full md:max-w-[500px] animate-slide-in`}
      role="alert"
    >
      <Icon name={icon} className="w-5 h-5 flex-shrink-0" />
      <p className="flex-1 text-sm leading-relaxed">{toast.message}</p>
      <IconButton
        icon="close"
        label="Close notification"
        onClick={() => removeToast(toast.id)}
        size="sm"
        tone="onColor"
      />
    </div>
  );
}

export function ToastContainer() {
  const { toasts } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-16 left-2 right-2 md:left-4 md:right-auto z-50 flex flex-col gap-2 safe-area-bottom">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
