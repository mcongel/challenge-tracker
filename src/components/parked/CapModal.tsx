import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { FormError, ModalFooter, useModalForm } from '../ui/useModalForm';
import { inputCls } from '../../lib/utils';

export function CapModal({
  current, onSave, onClose,
}: {
  current: number;
  onSave: (v: number) => Promise<void>;
  onClose: () => void;
}) {
  const [pct, setPct] = useState(String(Math.round(current * 100)));

  const { busy, formError, submit } = useModalForm(async () => {
    const v = Number(pct);
    if (!v || v <= 0 || v > 100) throw new Error('Enter a percentage between 1 and 100.');
    await onSave(v / 100);
    onClose();
  });

  return (
    <Modal isOpen onClose={onClose} title="Semiconductor concentration cap">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Cap (% of pile)">
          <input type="number" min="1" max="100" step="1" required value={pct} autoFocus
            onChange={(e) => setPct(e.target.value)} className={inputCls} />
        </Field>
        <p className="text-xs text-gray-400">
          Above this share of the pile in Semiconductors, the OVER CAP banner fires — trim semis first.
        </p>
        <FormError message={formError} />
        <ModalFooter busy={busy} label="Save cap" />
      </form>
    </Modal>
  );
}
