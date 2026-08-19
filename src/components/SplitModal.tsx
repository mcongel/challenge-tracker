import { useState } from 'react';
import { Modal } from './ui/Modal';
import { useData } from '../contexts/DataContext';
import { errorMessage, inputCls, labelCls, primaryBtnCls, todayISO } from '../lib/utils';

/** Stock-split recorder, shared by Positions (challenge lots) and the pile —
 * one split applies to every open lot and parked position for the ticker. */
export function SplitModal({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const { recordSplit } = useData();
  const [ratio, setRatio] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = Number(ratio);
    if (!r || r <= 0) return setFormError('Ratio must be positive — e.g. 2 for a 2:1 split.');
    setBusy(true);
    try {
      await recordSplit(ticker, r, todayISO());
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Record split — ${ticker}`}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={labelCls}>Ratio (shares multiply, cost divides)</label>
          <input type="number" step="any" min="0.01" required value={ratio}
            onChange={(e) => setRatio(e.target.value)} className={inputCls} placeholder="2 = 2:1 split" />
        </div>
        <p className="text-xs text-gray-400">
          Applies to all open {ticker} lots and any parked {ticker} position; logs the event in notes.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Recording…' : 'Record split'}</button>
        </div>
      </form>
    </Modal>
  );
}
