import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ConfirmModal } from '../ui/ConfirmModal';
import { TotalField } from '../ui/TotalField';
import { useData } from '../../contexts/DataContext';
import type { DividendClassification, ParkedLot, ParkedPosition, UnlockSummary } from '../../lib/engine';
import {
  adjustmentsForLots, aggregateLotsAdjusted, basisExhaustedLotIds, positionTotalReturn, roundCents,
} from '../../lib/engine';
import { useNotional } from '../../lib/useNotional';
import {
  cn, formatCurrency, formatPercent, inputCls, labelCls, primaryBtnCls, secondaryBtnCls, todayISO,
} from '../../lib/utils';
import { CLASSIFICATION_LABELS, classificationPillCls, fmtSh, unlockSentence } from './shared';

export function LotPanel({ position: p, summary }: { position: ParkedPosition; summary: UnlockSummary }) {
  const {
    parkedLots, parkedLotAdjustments, parkedSales, addParkedLot, deleteParkedLot, overrides, quotes,
  } = useData();
  const { lots, adjustedAgg, exhausted } = useMemo(() => {
    const positionLots = parkedLots
      .filter((l) => l.parkedPositionId === p.id)
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    const positionAdjs = adjustmentsForLots(positionLots, parkedLotAdjustments);
    return {
      lots: positionLots,
      adjustedAgg: aggregateLotsAdjusted(positionLots, positionAdjs),
      exhausted: new Set(basisExhaustedLotIds(positionLots, positionAdjs)),
    };
  }, [parkedLots, parkedLotAdjustments, p.id]);
  const totalReturn = useMemo(
    () => positionTotalReturn(
      p, lots, parkedLotAdjustments,
      parkedSales.filter((s) => s.ticker === p.ticker && s.accountId === p.accountId),
    ),
    [p, lots, parkedLotAdjustments, parkedSales],
  );
  const effectivePrice = overrides[p.ticker] ?? quotes[p.ticker] ?? p.currentPrice;
  const lastDiv = lots.filter((l) => l.source === 'dividend' && l.date).at(-1);

  const [mode, setMode] = useState<'purchase' | 'dividend' | null>(null);
  const [date, setDate] = useState('');
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [reinvested, setReinvested] = useState(true);
  const [classification, setClassification] = useState<DividendClassification>('unclassified');
  const [exDate, setExDate] = useState('');
  // Dividends accept either entry: dollars (amount) or shares — whichever was
  // typed last drives, the other computes from the reinvest price.
  const [divDriver, setDivDriver] = useState<'amount' | 'shares'>('amount');
  // Purchases get their own notional binding (shares × price ↔ total); the
  // dividend fields keep their separate amount↔shares sync below.
  const pur = useNotional();

  const syncFromAmount = (amt: string, pr: string) => {
    setAmount(amt);
    setDivDriver('amount');
    const a = Number(amt); const pnum = Number(pr);
    if (a > 0 && pnum > 0) setShares(String(Number((a / pnum).toFixed(8))));
  };
  const syncFromShares = (sh: string, pr: string) => {
    setShares(sh);
    setDivDriver('shares');
    const s = Number(sh); const pnum = Number(pr);
    if (s > 0 && pnum > 0) setAmount(String(roundCents(s * pnum)));
  };
  const syncFromPrice = (pr: string) => {
    setPrice(pr);
    if (mode !== 'dividend') return;
    if (divDriver === 'amount') syncFromAmount(amount, pr);
    else syncFromShares(shares, pr);
  };
  const [deleting, setDeleting] = useState<ParkedLot | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openForm = (m: 'purchase' | 'dividend') => {
    setMode(m);
    setDate(todayISO());
    setShares('');
    setAmount('');
    setPrice(m === 'dividend' && effectivePrice ? String(effectivePrice) : '');
    pur.reset();
    setClassification('unclassified');
    setExDate('');
    setFormError(null);
    setJustAdded(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      if (mode === 'purchase') {
        const sh = Number(pur.shares);
        const pr = Number(pur.price);
        if (!sh || sh <= 0 || !pr || pr <= 0) throw new Error('Enter shares and price.');
        await addParkedLot({
          parkedPositionId: p.id,
          date: date || null,
          source: 'purchase',
          shares: sh,
          price: pr,
          amount: roundCents(sh * pr),
        });
        setMode(null);
      } else {
        const pr = Number(price);
        if (reinvested && (!pr || pr <= 0)) throw new Error('Reinvested dividends need the reinvestment price.');
        const amt = Number(amount) > 0 ? Number(amount) : Number(shares) > 0 && pr > 0 ? Number(shares) * pr : 0;
        if (amt <= 0) throw new Error('Enter the dividend as dollars or shares.');
        const sh = reinvested ? (Number(shares) > 0 ? Number(shares) : amt / pr) : 0;
        await addParkedLot({
          parkedPositionId: p.id,
          date: date || null,
          source: 'dividend',
          shares: sh,
          price: reinvested ? pr : null,
          amount: roundCents(amt),
          classification,
          exDate: exDate || null,
          notes: reinvested ? 'reinvested' : 'cash',
        });
        // Streaks are the norm (daily/monthly payers entered in a run) — keep
        // the form open with date/classification/reinvest intact and the
        // per-entry fields cleared. Ex-date clears too: it differs per
        // payment, and a silently inherited one is wrong holding-period
        // evidence.
        setAmount('');
        setShares('');
        setExDate('');
        setJustAdded(`Added ${formatCurrency(roundCents(amt))} ✓ — form kept for the next one`);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
        {p.ticker} — lots &amp; dividends
      </p>
      <p className="text-sm text-gray-600 mb-3">
        {unlockSentence(summary)}
        {totalReturn.invested > 0 && (
          <span className="text-gray-500">
            {' '}Total return{' '}
            <span className={cn('font-medium tabular-nums', totalReturn.total >= 0 ? 'text-green-600' : 'text-red-600')}>
              {totalReturn.total >= 0 ? '+' : '−'}{formatCurrency(Math.abs(roundCents(totalReturn.total)))}
              {totalReturn.pct != null && ` (${formatPercent(totalReturn.pct)})`}
            </span>
            {' '}— unrealized {formatCurrency(roundCents(totalReturn.unrealized))} · income{' '}
            {formatCurrency(roundCents(totalReturn.income))} · realized {formatCurrency(roundCents(totalReturn.realized))}
            {totalReturn.unknownBasisSales > 0 && ` · ${totalReturn.unknownBasisSales} unknown-basis sale${totalReturn.unknownBasisSales > 1 ? 's' : ''} excluded`}.
          </span>
        )}
        {lastDiv && (
          <span className="text-gray-500"> Last dividend {lastDiv.date} ({formatCurrency(lastDiv.amount)}).</span>
        )}
        {adjustedAgg.adjustedCostBasis < adjustedAgg.costBasis - 0.005 && (
          <span className="text-gray-500">
            {' '}Basis {formatCurrency(roundCents(adjustedAgg.costBasis))} original ·{' '}
            {formatCurrency(roundCents(adjustedAgg.adjustedCostBasis))} after ROC — sales are taxed
            against the adjusted number.
          </span>
        )}
      </p>
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className="max-h-64 overflow-y-auto rounded-md border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {/* Computation stays chronological (FIFO, last-dividend); the
                  list reads newest-first like every other history table. */}
              {[...lots].reverse().map((l) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className={cn('px-3 py-2 tabular-nums w-28', l.date ? 'text-gray-600' : 'text-amber-800')}>
                    {l.date ?? 'no date'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                      l.source === 'purchase' ? 'bg-indigo-50 text-indigo-700' : 'bg-sky-50 text-sky-700')}>
                      {l.source === 'dividend' ? (l.shares > 0 ? 'dividend · DRIP' : 'dividend · cash') : 'purchase'}
                    </span>
                    {l.source === 'dividend' && (
                      <span className={cn('ml-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                        classificationPillCls(l.classification ?? 'unclassified'))}>
                        {CLASSIFICATION_LABELS[l.classification ?? 'unclassified']}
                      </span>
                    )}
                    {exhausted.has(l.id) && (
                      <span className="ml-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-800"
                        title="ROC has consumed this lot's entire basis — further ROC on it is capital gain.">
                        basis 0
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {l.shares > 0 ? `${fmtSh(l.shares)} sh` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{formatCurrency(l.amount)}</td>
                  <td className="px-1 py-2 w-8">
                    <button onClick={() => setDeleting(l)} className="p-1 rounded hover:bg-red-50" aria-label="Delete lot">
                      <Trash2 className="h-3.5 w-3.5 text-gray-300 hover:text-red-600" />
                    </button>
                  </td>
                </tr>
              ))}
              {lots.length === 0 && (
                <tr><td className="px-3 py-4 text-sm text-gray-400 text-center">No lots yet</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div>
        {mode === null ? (
          <div className="flex gap-2">
            <button onClick={() => openForm('purchase')} className={secondaryBtnCls}>Add past purchase</button>
            <button onClick={() => openForm('dividend')} className={secondaryBtnCls}>Add dividend</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-xs font-medium text-gray-500">
              {mode === 'purchase' ? 'Past purchase' : 'Dividend'}
            </p>
            {mode === 'purchase' ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Shares</label>
                  <input type="number" step="any" min="0.00000001" required value={pur.shares}
                    onChange={(e) => pur.setShares(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Price ($)</label>
                  <input type="number" step="any" min="0" required value={pur.price}
                    onChange={(e) => pur.setPrice(e.target.value)} className={inputCls} />
                </div>
                <TotalField value={pur.total} onChange={pur.setTotal} />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Date</label>
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
                  </div>
                  {reinvested && (
                    <div>
                      <label className={labelCls}>Reinvest price ($)</label>
                      <input type="number" step="any" min="0" value={price}
                        onChange={(e) => syncFromPrice(e.target.value)} className={inputCls} />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Amount ($)</label>
                    <input type="number" step="any" min="0" value={amount}
                      onChange={(e) => syncFromAmount(e.target.value, price)} className={inputCls} />
                  </div>
                  {reinvested && (
                    <div>
                      <label className={labelCls}>Shares</label>
                      <input type="number" step="any" min="0" value={shares}
                        onChange={(e) => syncFromShares(e.target.value, price)} className={inputCls} />
                    </div>
                  )}
                </div>
              </>
            )}
            {mode === 'dividend' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Classification</label>
                    <select value={classification} className={inputCls}
                      onChange={(e) => setClassification(e.target.value as DividendClassification)}>
                      <option value="unclassified">Unclassified (confirm later)</option>
                      <option value="qualified">Qualified</option>
                      <option value="ordinary">Ordinary (non-qualified)</option>
                      <option value="return_of_capital">Return of capital</option>
                      <option value="capital_gain_dist">Capital gain distribution</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Ex-date (optional)</label>
                    <input type="date" value={exDate} onChange={(e) => setExDate(e.target.value)}
                      className={inputCls} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={reinvested} onChange={(e) => setReinvested(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600" />
                  Reinvested (DRIP) — enter dollars or shares, the other computes. The shares get
                  their own 366-day clock.
                </label>
              </>
            )}
            {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
            {justAdded && !formError && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">{justAdded}</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setMode(null)} className={secondaryBtnCls}>
                {justAdded ? 'Done' : 'Cancel'}
              </button>
              <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Saving…' : 'Add'}</button>
            </div>
          </form>
        )}

        <p className="text-xs text-gray-400 mt-3">
          Shares and cost basis derive from these lots. To fix a wrong entry, delete it and re-add —
          any ROC that was applied to it flips back to "unallocated" on the Income screen for
          one-click re-spreading. Leave the date blank only if it's truly unknown — dated lots
          drive the unlock countdowns.
        </p>
        </div>
      </div>

      {deleting && (
        <ConfirmModal
          title="Delete lot"
          message={`Delete this ${deleting.source} (${deleting.shares > 0 ? `${fmtSh(deleting.shares)} sh, ` : ''}${formatCurrency(deleting.amount)})? The position's shares and cost recompute without it.`}
          onConfirm={() => deleteParkedLot(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
