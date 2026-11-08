import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
}

export default function Modal({ open, title, description, children, footer, onClose, width = 480 }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div>
            <h3>{title}</h3>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </header>
        {children && <div className="modal-body">{children}</div>}
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onClose
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>{cancelLabel}</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </>
      }
    >
      {danger && (
        <div className="modal-alert">
          <AlertTriangle size={18} />
          <span>This action cannot be undone.</span>
        </div>
      )}
    </Modal>
  );
}

interface RenameDialogProps {
  open: boolean;
  currentName: string;
  onRename: (name: string) => void | Promise<void>;
  onClose: () => void;
}

export function RenameDialog({ open, currentName, onRename, onClose }: RenameDialogProps) {
  const [value, setValue] = useState(currentName);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(currentName);
      setBusy(false);
    }
  }, [open, currentName]);

  const submit = async () => {
    const clean = value.replace(/\s+/g, ' ').trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      await onRename(clean);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Rename course"
      description="This only changes the name inside CourseFlow. The folder and video files on disk stay exactly where they are."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !value.trim()}>
            {busy ? 'Saving...' : 'Save name'}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Course name</span>
        <input
          className="text-input"
          value={value}
          maxLength={120}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="e.g. Advanced JavaScript"
        />
      </label>
    </Modal>
  );
}
