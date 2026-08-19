import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { FormError } from '../ui/useModalForm';
import { useData } from '../../contexts/DataContext';
import { errorMessage, inputCls, primaryBtnCls, secondaryBtnCls } from '../../lib/utils';

/** Shared with the Parked Pile — a split is per-ticker and adjusts challenge
 * lots AND parked holdings in one action, whichever screen opens it. */
export function PriceModal({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const { overrides, setOverride, clearOverride } = useData();
  const [price, setPrice] = useState(overrides[ticker] ? String(overrides[ticker]) : '');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Deliberately NOT useModalForm: the Clear override button drives the same
  // busy flag outside the submit path.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = Number(price);
    if (!p || p <= 0) return setFormError('Price must be positive.');
    setBusy(true);
    try {
      await setOverride(ticker, p);
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Price — ${ticker}`}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Manual price ($)">
          <input type="number" step="0.01" min="0.01" required value={price} autoFocus
            onChange={(e) => setPrice(e.target.value)} className={inputCls} />
        </Field>
        <p className="text-xs text-gray-400">
          Manual prices are pinned — they beat API quotes until cleared.
        </p>
        <FormError message={formError} />
        <div className="flex justify-end gap-2">
          {overrides[ticker] !== undefined && (
            <button type="button" disabled={busy} className={secondaryBtnCls}
              onClick={async () => { setBusy(true); try { await clearOverride(ticker); onClose(); } finally { setBusy(false); } }}>
              Clear override
            </button>
          )}
          <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Saving…' : 'Pin price'}</button>
        </div>
      </form>
    </Modal>
  );
}
