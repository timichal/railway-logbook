// Toast notification system exports

export { ToastProvider, useToast } from './ToastContext';
export { ToastContainer } from './ToastContainer';
export { ConfirmDialog } from './ConfirmDialog';
export type { Toast, ToastType, ToastContextValue, ActionResult, ActionSuccess, ActionError } from './types';

// Helper function to handle server action results in components
export function handleActionResult<T>(
  result: { success: boolean; data?: T; error?: string },
  onSuccess: (data: T) => void,
  onError: (error: string) => void
): void {
  if (result.success && result.data !== undefined) {
    onSuccess(result.data);
  } else if (!result.success && result.error) {
    onError(result.error);
  }
}
