import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  detail?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  detail,
  confirmText = '确定',
  cancelText = '取消',
  variant = 'warning',
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  const variantStyles = {
    danger: {
      icon: 'text-red-400',
      confirmBtn: 'bg-red-600 hover:bg-red-500 text-white',
      detailBg: 'bg-red-950/30 border-red-500/20',
    },
    warning: {
      icon: 'text-amber-400',
      confirmBtn: 'bg-amber-600 hover:bg-amber-500 text-white',
      detailBg: 'bg-amber-950/30 border-amber-500/20',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={dialogRef}
        className="bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-md mx-4"
      >
        <div className="flex items-center gap-3 px-6 pt-6 pb-2">
          <div className={`p-2 rounded-xl bg-gray-800 ${styles.icon}`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-semibold text-white flex-1">{title}</h3>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-4">
          <p className="text-sm text-gray-300 leading-relaxed">{message}</p>
          {detail && (
            <div className={`mt-3 p-3 rounded-xl border ${styles.detailBg}`}>
              {detail}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 pb-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-600 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${styles.confirmBtn}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
