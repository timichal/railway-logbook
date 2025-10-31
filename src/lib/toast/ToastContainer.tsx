'use client';

import { useToast } from './ToastContext';
import type { Toast, ToastType } from './types';

const toastStyles: Record<ToastType, string> = {
  success: 'bg-green-600 border-green-700',
  error: 'bg-red-600 border-red-700',
  warning: 'bg-orange-600 border-orange-700',
  info: 'bg-blue-600 border-blue-700',
};

const toastIcons: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

function ToastItem({ toast }: { toast: Toast }) {
  const { removeToast } = useToast();
  const styles = toastStyles[toast.type];
  const icon = toastIcons[toast.type];

  return (
    <div
      className={`${styles} text-white px-4 py-3 rounded-md shadow-lg border flex items-center gap-3 min-w-[300px] max-w-[500px] animate-slide-in`}
      role="alert"
    >
      <span className="text-lg font-bold flex-shrink-0">{icon}</span>
      <p className="flex-1 text-sm leading-relaxed">{toast.message}</p>
      <button
        onClick={() => removeToast(toast.id)}
        className="flex-shrink-0 text-white hover:text-gray-200 text-lg font-bold leading-none cursor-pointer"
        aria-label="Close notification"
      >
        ×
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-16 left-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
