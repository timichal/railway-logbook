// Toast notification types

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

export interface ToastContextValue {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  showSuccess: (message: string, duration?: number) => void;
  showError: (message: string, duration?: number) => void;
  showWarning: (message: string, duration?: number) => void;
  showInfo: (message: string, duration?: number) => void;
  removeToast: (id: string) => void;
}

// Server action result types
export interface ActionSuccess<T = void> {
  success: true;
  data: T;
}

export interface ActionError {
  success: false;
  error: string;
}

export type ActionResult<T = void> = ActionSuccess<T> | ActionError;
