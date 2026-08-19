import { useState } from 'react';
import { X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { FormError, useModalForm } from '../ui/useModalForm';
import { useData } from '../../contexts/DataContext';
import type { CloseAllocation } from '../../lib/engine';
import { addDays, closeShares } from '../../lib/engine';
import {
  cn, errorMessage, formatCurrency, inputCls, labelCls, money, primaryBtnCls,
  secondaryBtnCls, todayISO,
} from '../../lib/utils';
import { useNotional } from '../../lib/useNotional';
import { TotalField } from '../ui/TotalField';

export function ClosePositionModal({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const { lots, closePosition } = useData();
  const tickerLots = lots
    .filter((l) => l.ticker === ticker)
    .sort((a, b) => a.buyDate.localeCompare(b.buyDate));
  const totalShares = tickerLots.reduce((s, l) => s + l.shares, 0);

  const { shares, price, total, setShares, setPrice, setTotal } = useNotional({
    shares: String(totalShares),
  });
  const [closeDate, setCloseDate] = useState(todayISO());
  const [customize, setCustomize] = useState(false);
  const [allocs, setAllocs] = useState<Record<string, string>>({});
  const [fees, setFees] = useState('');
  const [exitReason, setExitReason] = useState('');

  const numShares = Number(shares);
  const numPrice = Number(price);
  const feeNum = Number(fees) || 0;

  const allocations: CloseAllocation[] | undefined = customize
    ? tickerLots
        .map((l) => ({ lotId: l.id, shares: Number(allocs[l.id] ?? 0) }))
        .filter((a) => a.shares > 0)
    : undefined;

  let preview: ReturnType<typeof closeShares> | null = null;
  let previewError: string | null = null;
  if (numShares > 0 && numPrice > 0) {
    try {
      preview = closeShares(lots, ticker, numShares, numPrice, closeDate, allocations);
    } catch (e) {
      previewError = errorMessage(e);
    }
  }
  const realizedTotal = preview
    ? preview.trades.reduce((s, t) => s + (t.proceeds - t.costBasis), 0) - feeNum
    : 0;

  const enableCustomize = () => {
    // Seed the per-lot inputs from the FIFO allocation so overriding starts sane.
    let remaining = numShares;
    const seed: Record<string, string> = {};
    for (const l of tickerLots) {
      const take = Math.min(l.shares, Math.max(0, remaining));
      seed[l.id] = String(take);
      remaining -= take;
    }
    setAllocs(seed);
    setCustomize(true);
  };

  const { busy, formError, submit } = useModalForm(async () => {
    if (previewError) throw new Error(previewError);
    if (!preview) throw new Error('Enter shares and price.');
    if (feeNum < 0 || feeNum >= preview.totalProceeds) {
      throw new Error('Fees must be smaller than the gross proceeds.');
    }
    await closePosition(ticker, numShares, numPrice, closeDate, allocations, feeNum || undefined, exitReason || null);
    onClose();
  });

  return (
    <Modal isOpen onClose={onClose} title={`Close ${ticker}`}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Shares (of ${totalShares})`}>
            <input type="number" step="any" min="0.00000001" required value={shares}
              onChange={(e) => setShares(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Close date">
            <input type="date" required value={closeDate} onChange={(e) => setCloseDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Price / share ($)">
            <input type="number" step="any" min="0.00000001" required value={price}
              onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </Field>
          <TotalField value={total} onChange={setTotal} label="Total proceeds ($)" />
          <Field label="Fees ($, optional)">
            <input type="number" step="0.01" min="0" value={fees} placeholder="SEC/FINRA fees"
              onChange={(e) => setFees(e.target.value)} className={inputCls} />
          </Field>
          <div>
            <label className={labelCls} title="One tap of self-knowledge — the pattern card reads these to judge whether your written targets are calibrated.">
              Why the exit?
            </label>
            <select value={exitReason} onChange={(e) => setExitReason(e.target.value)} className={inputCls}>
              <option value="">— optional —</option>
              <option value="target_hit">Target hit</option>
              <option value="calendar">Calendar / pre-event</option>
              <option value="early">Early — took profit</option>
              <option value="thesis_broke">Thesis broke</option>
            </select>
          </div>
        </div>

        {!customize ? (
          <button type="button" onClick={enableCustomize}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
            Closing oldest lots first (FIFO) — customize per lot
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500">Shares to take from each lot</p>
              <button type="button" onClick={() => setCustomize(false)}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-0.5">
                <X className="h-3 w-3" /> back to FIFO
              </button>
            </div>
            {tickerLots.map((l) => (
              <div key={l.id} className="flex items-center gap-2 text-sm">
                <span className="text-gray-500 tabular-nums w-28">{l.buyDate}</span>
                <span className="text-gray-400 tabular-nums w-20 text-right">{l.shares} sh</span>
                <input type="number" step="any" min="0" max={l.shares} value={allocs[l.id] ?? '0'}
                  onChange={(e) => setAllocs((a) => ({ ...a, [l.id]: e.target.value }))}
                  className={cn(inputCls, 'w-28')} />
              </div>
            ))}
          </div>
        )}

        {previewError && <p className="text-sm text-amber-800 bg-amber-50 rounded-md px-3 py-2">{previewError}</p>}
        {preview && (
          <div className="bg-gray-50 rounded-md px-3 py-2 text-sm space-y-1">
            <p className="text-gray-600">
              {preview.trades.length} trade{preview.trades.length > 1 ? 's' : ''} · proceeds{' '}
              <span className="font-medium tabular-nums">{money(preview.totalProceeds - feeNum)}</span>
              {feeNum > 0 && <span className="text-gray-400"> (net of {formatCurrency(feeNum)} fees)</span>}{' '}
              · realized{' '}
              <span className={cn('font-medium tabular-nums', realizedTotal >= 0 ? 'text-green-600' : 'text-red-600')}>
                {money(realizedTotal)}
              </span>
            </p>
            {realizedTotal < 0 && (
              <p className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1">
                Selling at a loss: rebuying {ticker} anywhere — any brokerage — before{' '}
                <span className="font-bold tabular-nums">{addDays(closeDate, 31)}</span> disallows
                this loss (Rule 9).
              </p>
            )}
            <p className="text-xs text-gray-400">
              Writes the trades to the Trade Log and the Sell to the Cash Ledger. Remaining shares
              keep their original buy dates.
            </p>
          </div>
        )}
        <FormError message={formError} />
        {/* Not ModalFooter: submit also stays disabled until the preview computes. */}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryBtnCls}>Cancel</button>
          <button type="submit" disabled={busy || !preview} className={primaryBtnCls}>
            {busy ? 'Closing…' : 'Close position'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
