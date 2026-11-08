import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import type { ToastType } from '../types';

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info
};

export default function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type];
        return (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <span className="toast-icon">
              <Icon size={18} />
            </span>
            <span className="toast-message">{toast.message}</span>
            <button className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
