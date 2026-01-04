'use client';

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import type { Toast, ToastType, ToastContextValue, ConfirmDialogOptions } from './types';
import { ConfirmDialog } from './ConfirmDialog';

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogOptions | null>(null);
  const nextIdRef = useRef(0);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info', duration: number = 5000) => {
    const id = `toast-${nextIdRef.current++}`;
    const toast: Toast = { id, message, type, duration };

    setToasts((prev) => [...prev, toast]);

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
  }, [removeToast]);

  const showSuccess = useCallback((message: string, duration?: number) => {
    showToast(message, 'success', duration);
  }, [showToast]);

  const showError = useCallback((message: string, duration?: number) => {
    showToast(message, 'error', duration);
  }, [showToast]);

  const showWarning = useCallback((message: string, duration?: number) => {
    showToast(message, 'warning', duration);
  }, [showToast]);

  const showInfo = useCallback((message: string, duration?: number) => {
    showToast(message, 'info', duration);
  }, [showToast]);

  const showConfirm = useCallback((options: ConfirmDialogOptions) => {
    setConfirmDialog(options);
  }, []);

  const handleConfirm = useCallback(() => {
    if (confirmDialog) {
      confirmDialog.onConfirm();
      setConfirmDialog(null);
    }
  }, [confirmDialog]);

  const handleCancel = useCallback(() => {
    if (confirmDialog) {
      confirmDialog.onCancel?.();
      setConfirmDialog(null);
    }
  }, [confirmDialog]);

  const handleThird = useCallback(() => {
    if (confirmDialog) {
      confirmDialog.onThird?.();
      setConfirmDialog(null);
    }
  }, [confirmDialog]);

  const value: ToastContextValue = {
    toasts,
    showToast,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    removeToast,
    showConfirm,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ConfirmDialog
        isOpen={!!confirmDialog}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message || ''}
        confirmLabel={confirmDialog?.confirmLabel}
        cancelLabel={confirmDialog?.cancelLabel}
        thirdLabel={confirmDialog?.thirdLabel}
        variant={confirmDialog?.variant}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        onThird={handleThird}
      />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
