import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { FormError, ModalFooter, useModalForm } from '../ui/useModalForm';
import { useData } from '../../contexts/DataContext';
import type { DividendClassification } from '../../lib/engine';
import { formatCurrency, inputCls } from '../../lib/utils';
import type { HistRow } from './shared';

export function ReclassifyModal({ row, onClose }: { row: HistRow; onClose: () => void }) {
  const { reclassifyDividend } = useData();
  const [classification, setClassification] = useState<DividendClassification>(
    row.lot.classification ?? 'unclassified',
  );
  const [exDate, setExDate] = useState(row.lot.exDate ?? '');

  const { busy, formError, submit } = useModalForm(async () => {
    await reclassifyDividend(row.lot.id, classification, exDate || null);
    onClose();
  });

  return (
    <Modal isOpen onClose={onClose} title={`Reclassify ${row.ticker} dividend`}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-gray-600">
          {row.lot.date ?? 'Undated'} · {formatCurrency(row.lot.amount)} ·{' '}
          {row.lot.shares > 0 ? 'DRIP' : 'cash'}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Classification">
            <select value={classification} className={inputCls}
              onChange={(e) => setClassification(e.target.value as DividendClassification)}>
              <option value="unclassified">Unclassified</option>
              <option value="qualified">Qualified</option>
              <option value="ordinary">Ordinary (non-qualified)</option>
              <option value="return_of_capital">Return of capital</option>
              <option value="capital_gain_dist">Capital gain distribution</option>
            </select>
          </Field>
          <Field label="Ex-date (optional)">
            <input type="date" value={exDate} onChange={(e) => setExDate(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <p className="text-xs text-gray-400">
          Brokers reclassify distributions on the 1099 after year end — this records the correction
          and flags the row so you know it was revised.
        </p>
        <FormError message={formError} />
        <ModalFooter busy={busy} label="Save" onCancel={onClose} />
      </form>
    </Modal>
  );
}
