import { useState } from 'react';
import { cn, errorMessage, primaryBtnCls, secondaryBtnCls } from '../../lib/utils';

/** The busy/error/submit boilerplate every modal form repeats. Validation
 * failures are thrown Errors — they surface in the same red strip a DB
 * failure does, via <FormError>. */
export function useModalForm(onSubmit: () => Promise<void> | void) {
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      await onSubmit();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, formError, setFormError, submit };
}

/** The house error strip. Renders nothing when there is no error. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{message}</p>;
}

/** Right-aligned modal action row: optional Cancel, then the submit button
 * with its busy label. */
export function ModalFooter({
  busy, label, busyLabel = 'Saving…', onCancel, cancelLabel = 'Cancel', className,
}: {
  busy: boolean;
  label: React.ReactNode;
  busyLabel?: React.ReactNode;
  onCancel?: () => void;
  cancelLabel?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex justify-end gap-2', className)}>
      {onCancel && (
        <button type="button" onClick={onCancel} className={secondaryBtnCls}>
          {cancelLabel}
        </button>
      )}
      <button type="submit" disabled={busy} className={primaryBtnCls}>
        {busy ? busyLabel : label}
      </button>
    </div>
  );
}
