import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { TotalField } from '../ui/TotalField';
import { useData } from '../../contexts/DataContext';
import type { ParkedSale } from '../../lib/engine';
import { roundCents } from '../../lib/engine';
import { useNotional } from '../../lib/useNotional';
import { cn, formatCurrency, inputCls, labelCls, primaryBtnCls } from '../../lib/utils';
import { fmtSh } from './shared';

export function EditSaleModal({ sale: s, onClose }: { sale: ParkedSale; onClose: () => void }) {
  const { updateParkedSale, editParkedSaleAmounts } = useData();
  // Snapshot sales re-derive basis and term from the lots — their numbers are
  // truly editable. Legacy (pre-snapshot) sales can only correct the record.
  const snapshotMode = Boolean(s.consumed);
  const [date, setDate] = useState(s.date);
  const { shares, price, total, setShares, setPrice, setTotal } = useNotional({
    shares: String(s.shares),
    price: String(s.pricePerShare),
    total: String(s.proceeds), // the stored dollars, not the rounded product
    driver: 'total', // share edits re-derive price from the EXACT proceeds
  });
  const [basis, setBasis] = useState(s.costBasis != null ? String(s.costBasis) : '');
  const [ltShares, setLtShares] = useState(s.ltShares != null ? String(s.ltShares) : '');
  const [funded, setFunded] = useState(s.fundedChallenge);
  const [notes, setNotes] = useState(s.notes ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const numBasis = Number(basis);
  const gainPreview = snapshotMode
    ? null
    : basis !== '' && numBasis >= 0 ? s.proceeds - numBasis : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (snapshotMode) {
      const sh = Number(shares);
      const pr = Number(price);
      if (!sh || sh <= 0) return setFormError('Enter the shares sold.');
      if (!pr || pr <= 0) return setFormError('Enter the sale price.');
      // Only a real number change goes through the destructive undo+re-apply;
      // funded/notes-only edits patch the record in place.
      const numbersChanged =
        Math.abs(sh - s.shares) > 1e-9 ||
        Math.abs(pr - s.pricePerShare) > 1e-9 ||
        date !== s.date;
      setBusy(true);
      try {
        if (numbersChanged) {
          await editParkedSaleAmounts(s.id, {
            shares: sh,
            pricePerShare: pr,
            date,
            fundedChallenge: funded,
            notes: notes || null,
          });
        } else {
          await updateParkedSale(s.id, { fundedChallenge: funded, notes: notes || null });
        }
        onClose();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (ltShares !== '' && Number(ltShares) > s.shares + 1e-9) {
      return setFormError(`Long-term shares can't exceed the ${fmtSh(s.shares)} sh sold.`);
    }
    setBusy(true);
    try {
      await updateParkedSale(s.id, {
        date,
        costBasis: basis === '' ? null : roundCents(numBasis),
        ltShares: ltShares === '' ? null : Number(ltShares),
        fundedChallenge: funded,
        notes: notes || null,
      });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Edit sale — ${s.ticker} (${fmtSh(s.shares)} sh, ${formatCurrency(s.proceeds)})`}>
      <form onSubmit={submit} className="space-y-3">
        {snapshotMode ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Date</label>
                <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Shares</label>
                <input type="number" step="any" min="0.00000001" required value={shares}
                  onChange={(e) => setShares(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Price ($)</label>
                <input type="number" step="any" min="0" required value={price}
                  onChange={(e) => setPrice(e.target.value)} className={inputCls} />
              </div>
              <TotalField value={total} onChange={setTotal} label="Total proceeds ($)" />
            </div>
            <p className="text-xs text-gray-400">
              Saving undoes this sale and re-applies it with the corrected numbers — lots, basis,
              and long-term split all re-derive. The challenge ledger is never touched; if this
              sale funded a Deposit whose amount changed, fix it on the Cash Ledger.
            </p>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Date</label>
                <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Cost basis ($)</label>
                <input type="number" step="any" min="0" value={basis} placeholder="unknown"
                  onChange={(e) => setBasis(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Long-term shares (of {fmtSh(s.shares)})</label>
                <input type="number" step="any" min="0" value={ltShares} placeholder="unknown"
                  onChange={(e) => setLtShares(e.target.value)} className={inputCls} />
              </div>
            </div>
            <p className="text-xs text-gray-400">
              Recorded before undo support — numbers only; shares and lots don't change.
            </p>
          </>
        )}
        {gainPreview !== null && (
          <p className="text-sm text-gray-600">
            Realized gain:{' '}
            <span className={cn('font-medium tabular-nums', gainPreview >= 0 ? 'text-green-600' : 'text-red-600')}>
              {formatCurrency(roundCents(gainPreview))}
            </span>
          </p>
        )}
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={funded} onChange={(e) => setFunded(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600" />
          Proceeds funded the challenge account
        </label>
        <p className="text-xs text-gray-400">
          This flag is bookkeeping only — it does not create or remove ledger deposits. If a
          deposit exists or is missing on the Cash Ledger, fix it there.
        </p>
        <div>
          <label className={labelCls}>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
