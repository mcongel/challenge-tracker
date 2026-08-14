import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { AccountSelect } from '../ui/AccountSelect';
import { useData } from '../../contexts/DataContext';
import type { ParkedPosition } from '../../lib/engine';
import { inputCls, labelCls, primaryBtnCls, todayISO } from '../../lib/utils';
import { fmtSh } from './shared';

export function TransferModal({ position: p, onClose }: { position: ParkedPosition; onClose: () => void }) {
  const { accounts, transferParked } = useData();
  const destinations = accounts.filter((a) => a.kind === 'outside' && a.id !== p.accountId);
  const [toAccountId, setToAccountId] = useState(destinations[0]?.id ?? '');
  const [shares, setShares] = useState(String(p.shares));
  const [date, setDate] = useState(todayISO());
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const numShares = Number(shares);
  const partial = numShares > 0 && numShares < p.shares - 1e-9;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!toAccountId) return setFormError('Pick the destination account.');
    if (!numShares || numShares <= 0) return setFormError('Enter shares to transfer.');
    if (numShares > p.shares + 1e-9) return setFormError(`Only ${fmtSh(p.shares)} shares parked.`);
    setBusy(true);
    try {
      await transferParked({ parkedId: p.id, toAccountId, shares: numShares, date });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Transfer ${p.ticker} (from ${p.account})`}>
      <form onSubmit={submit} className="space-y-3">
        <AccountSelect accounts={accounts.filter((a) => a.id !== p.accountId)} value={toAccountId}
          onChange={setToAccountId} label="To account" kinds={['outside']} allowNone={false} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Shares (of {fmtSh(p.shares)})</label>
            <input type="number" step="any" min="0.00000001" required value={shares}
              onChange={(e) => setShares(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Transfer date</label>
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
        </div>
        <p className="text-xs text-gray-400">
          Not a sale: lot slices move with their original dates and basis, so unlock clocks and
          taxes are unaffected. Oldest lots move first
          {partial && ' — the remainder (e.g. fractional shares an ACATS left behind) stays put with its own dates'}.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy || destinations.length === 0} className={primaryBtnCls}>
            {busy ? 'Transferring…' : 'Record transfer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
