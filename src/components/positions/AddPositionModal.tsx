import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { FormError, ModalFooter, useModalForm } from '../ui/useModalForm';
import { useData } from '../../contexts/DataContext';
import { washSaleConflicts } from '../../lib/engine';
import { inputCls, money, todayISO } from '../../lib/utils';
import { useNotional } from '../../lib/useNotional';
import { TotalField } from '../ui/TotalField';

export function AddPositionModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { addLot, lots, trades, outsideSales, parkedSales, accounts, retirementAccountIds } = useData();
  // Pile sales at a loss count for Rule 9 too — merge them into the radar.
  // Unknown-basis (legacy) sales can't prove a loss, so they warn as
  // POTENTIAL losses rather than slipping through the window silently.
  // Retirement-account sales carry no deductible loss — never on the radar.
  const saleRadar = [
    ...outsideSales.map((s) => ({ ...s, basisUnknown: false })),
    ...parkedSales
      .filter((s) => !retirementAccountIds.has(s.accountId))
      .filter((s) => s.costBasis == null || s.proceeds < s.costBasis)
      .map((s) => ({
        id: s.id, accountId: s.accountId, ticker: s.ticker, saleDate: s.date,
        loss: true, notes: null, basisUnknown: s.costBasis == null,
      })),
  ];
  const [ticker, setTicker] = useState('');
  const [buyDate, setBuyDate] = useState(todayISO());
  const { shares, price: avgCost, total, setShares, setPrice, setTotal, reset } = useNotional();
  const [exitTarget, setExitTarget] = useState('');
  const [exitDate, setExitDate] = useState('');
  const [thesis, setThesis] = useState('');

  // Rule 7 — one stock at a time. Warn (not block) so a same-day rotation
  // can be entered in either order.
  const otherOpenTickers = [
    ...new Set(
      lots.map((l) => l.ticker).filter((t) => ticker && t !== ticker.toUpperCase()),
    ),
  ];

  const conflicts = ticker
    ? washSaleConflicts(trades, saleRadar, ticker.toUpperCase(), buyDate)
    : { trades: [], outside: [] };
  const washCitations = [
    ...conflicts.trades.map((t) => `${t.closeDate} (challenge account)`),
    ...conflicts.outside.map(
      (s) =>
        `${s.saleDate} (${accounts.find((a) => a.id === s.accountId)?.name ?? 'outside'}${s.basisUnknown ? ', unknown basis — possible loss' : ''})`,
    ),
  ];

  const { busy, formError, submit } = useModalForm(async () => {
    if (!Number(exitTarget)) {
      throw new Error('Exit on the target — Rule 8. Write the target before the entry.');
    }
    await addLot({
      ticker: ticker.toUpperCase(),
      buyDate,
      shares: Number(shares),
      avgCost: Number(avgCost),
      exitTarget: Number(exitTarget),
      exitDate: exitDate || null,
      thesis: thesis || null,
    });
    setTicker(''); reset(); setExitTarget(''); setExitDate(''); setThesis('');
    onClose();
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add position">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ticker">
            <input required value={ticker} onChange={(e) => setTicker(e.target.value)} className={inputCls} placeholder="NBIS" />
          </Field>
          <Field label="Buy date">
            <input type="date" required value={buyDate} onChange={(e) => setBuyDate(e.target.value)} className={inputCls} />
          </Field>
        </div>

        {washCitations.length > 0 && (
          <div className="flex gap-2 bg-amber-50 text-amber-800 rounded-md px-3 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              Wash-sale window: {ticker.toUpperCase()} was sold at a loss on{' '}
              {washCitations.join(', ')} — buying within 31 days disallows that loss. Rule 9
              crosses brokerages.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Shares">
            <input type="number" step="any" min="0.00000001" required value={shares}
              onChange={(e) => setShares(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Avg cost ($)">
            <input type="number" step="any" min="0" required value={avgCost}
              onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </Field>
          <TotalField value={total} onChange={setTotal} label="Total cost ($)" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Exit target ($) — required">
            <input type="number" step="0.01" min="0.01" required value={exitTarget}
              onChange={(e) => setExitTarget(e.target.value)} className={inputCls}
              placeholder="the catalyst move you're selling into" />
          </Field>
          <Field label="Out by (date, optional)" hint="e.g. the session before the print">
            <input type="date" value={exitDate}
              onChange={(e) => setExitDate(e.target.value)} className={inputCls} />
          </Field>
        </div>

        {otherOpenTickers.length > 0 && (
          <div className="flex gap-2 bg-amber-50 text-amber-800 rounded-md px-3 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              One stock at a time — Rule 7. {otherOpenTickers.join(', ')}{' '}
              {otherOpenTickers.length > 1 ? 'are' : 'is'} still riding. Xu style is sell, then
              rotate — not split the stack.
            </span>
          </div>
        )}

        <p className="text-xs text-gray-400">
          Exit on the target — Rule 8. The buy also writes itself to the Cash Ledger
          ({shares && avgCost ? money(Number(shares) * Number(avgCost)) : '$—'}).
        </p>
        <Field label="Thesis / catalyst">
          <input value={thesis} onChange={(e) => setThesis(e.target.value)} className={inputCls} />
        </Field>
        <FormError message={formError} />
        <ModalFooter busy={busy} label="Open position" />
      </form>
    </Modal>
  );
}
