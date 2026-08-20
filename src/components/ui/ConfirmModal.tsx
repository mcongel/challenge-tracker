import { useState } from 'react';
import { Modal } from './Modal';
import { cn, secondaryBtnCls } from '../../lib/utils';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

/** House-style confirmation — never a native browser dialog. */
export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-sm text-text-secondary leading-relaxed">{message}</p>
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={secondaryBtnCls}>
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className={cn(
              'rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors',
            )}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
