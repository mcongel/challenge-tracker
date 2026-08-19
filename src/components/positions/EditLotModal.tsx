import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { FormError, ModalFooter, useModalForm } from '../ui/useModalForm';
import { useData } from '../../contexts/DataContext';
import type { PositionLot } from '../../lib/engine';
import { inputCls } from '../../lib/utils';

export function EditLotModal({ lot, onClose }: { lot: PositionLot; onClose: () => void }) {
  const { updateLotDetails } = useData();
  const [exitTarget, setExitTarget] = useState(String(lot.exitTarget));
  const [exitDate, setExitDate] = useState(lot.exitDate ?? '');
  const [buyDate, setBuyDate] = useState(lot.buyDate);
  const [thesis, setThesis] = useState(lot.thesis ?? '');

  const { busy, formError, submit } = useModalForm(async () => {
    if (!Number(exitTarget) || Number(exitTarget) <= 0) {
      throw new Error('Exit target must be a positive price — Rule 8 keeps it written.');
    }
    await updateLotDetails(lot.id, {
      exitTarget: Number(exitTarget),
      exitDate: exitDate || null,
      buyDate,
      thesis: thesis || null,
    });
    onClose();
  });

  return (
    <Modal isOpen onClose={onClose} title={`Edit ${lot.ticker} lot`}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Exit target ($)">
            <input type="number" step="any" min="0.01" required value={exitTarget}
              onChange={(e) => setExitTarget(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Buy date">
            <input type="date" required value={buyDate}
              onChange={(e) => setBuyDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Out by (date, optional)" hint="calendar exit — alerts as it closes in">
            <input type="date" value={exitDate}
              onChange={(e) => setExitDate(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="Thesis">
          <input value={thesis} onChange={(e) => setThesis(e.target.value)} className={inputCls} />
        </Field>
        <p className="text-xs text-gray-400">
          Shares and cost can't change — they anchor the Buy on the Cash Ledger and the basis math.
          A buy-date change moves the long-term clock and, when the lot is linked to its Buy row,
          moves that ledger date with it.
        </p>
        <FormError message={formError} />
        <ModalFooter busy={busy} label="Save changes" />
      </form>
    </Modal>
  );
}
