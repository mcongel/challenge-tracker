import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { TotalField } from '../ui/TotalField';
import { Field } from '../ui/Field';
import { FormError, ModalFooter, useModalForm } from '../ui/useModalForm';
import { useData } from '../../contexts/DataContext';
import type { ParkedPosition } from '../../lib/engine';
import {
  adjustmentsForLots, contributionStatus, depositExceedsCap, estimatedPileTax, isCryptoTicker,
  isNeverTrimFuel, netContributed, roundCents, trimPreview, unlockSummary,
} from '../../lib/engine';
import { useNotional } from '../../lib/useNotional';
import { fetchClose } from '../../lib/quotes';
import { cn, formatCurrency, formatPercent, inputCls, money, todayISO } from '../../lib/utils';
import { fmtSh } from './shared';

export function TrimModal({
  position: p, initialShares, onClose,
}: {
  position: ParkedPosition;
  /** Prefill (e.g. the trim-fuel card's unlocked count) — freely editable. */
  initialShares?: number;
  onClose: () => void;
}) {
  const {
    recordTrim, cashEvents, contributionCap, parkedLots, parkedLotAdjustments, ltTaxRate, stTaxRate,
    overrides, quotes,
  } = useData();
  const { shares, price, total, setShares, setPrice, setTotal } = useNotional({
    price: p.currentPrice ? String(p.currentPrice) : '',
    shares: initialShares != null ? String(initialShares) : undefined,
  });
  const [date, setDate] = useState(todayISO());
  // The pile stands on its own: selling does NOT presume funding the challenge.
  const [fund, setFund] = useState(false);
  // Today's trims prefill the shadow price from the live VOO quote (editable);
  // backdated trims still need the historical price by hand — changing the
  // date away from today clears a still-prefilled value, because the twin's
  // price is that DAY's price and is never re-derivable later.
  const vooQuote = overrides['VOO'] ?? quotes['VOO'];
  const [vooPrice, setVooPrice] = useState(vooQuote ? String(vooQuote) : '');
  const vooPrefilled = Boolean(vooQuote) && vooPrice === String(vooQuote) && date === todayISO();
  const changeDate = (d: string) => {
    setDate(d);
    if (d !== todayISO() && vooQuote && vooPrice === String(vooQuote)) setVooPrice('');
  };
  // Backdated funded trims auto-fill VOO's historical close (once per date;
  // a cleared field stays cleared; fetch failure falls back to the hint).
  const [vooClose, setVooClose] = useState<{ requested: string; actual: string } | null>(null);
  const [closeFailedFor, setCloseFailedFor] = useState<string | null>(null);
  const closeFetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!fund || date >= todayISO()) return;
    if (vooPrice !== '' || closeFetchedFor.current === date) return;
    closeFetchedFor.current = date;
    let cancelled = false;
    void fetchClose('VOO', date).then((r) => {
      if (cancelled) return;
      if (!r) {
        setCloseFailedFor(date);
        return;
      }
      setVooPrice(String(Math.round(r.close * 100) / 100));
      setVooClose({ requested: date, actual: r.date });
    });
    return () => { cancelled = true; };
  }, [fund, date, vooPrice]);
  const [fees, setFees] = useState('');
  const feeNum = Number(fees) || 0;

  const numShares = Number(shares);
  const numPrice = Number(price);
  const proceeds = numShares > 0 && numPrice > 0 ? roundCents(numShares * numPrice) : 0;
  const fullTrim = numShares >= p.shares - 1e-9;
  const positionLots = parkedLots.filter((l) => l.parkedPositionId === p.id);
  const summ = unlockSummary(positionLots, date);
  const dipsShortTerm = numShares > 0 && numShares > summ.unlockedShares + 1e-9;
  const neverTrimFuel = isNeverTrimFuel(p);
  let preview: ReturnType<typeof trimPreview> | null = null;
  if (numShares > 0 && numShares <= p.shares + 1e-9 && numPrice > 0 && positionLots.length > 0) {
    try {
      preview = trimPreview(
        positionLots, numShares, numPrice, date,
        adjustmentsForLots(positionLots, parkedLotAdjustments),
      );
    } catch {
      preview = null;
    }
  }
  const isLoss = preview ? preview.gain - feeNum < 0 : numPrice > 0 && numPrice < p.avgCost;

  const netProceeds = Math.max(0, roundCents(proceeds - feeNum));
  const contributed = netContributed(cashEvents);
  const overCap =
    fund && netProceeds > 0 && contributionCap !== null &&
    depositExceedsCap(contributed, netProceeds, contributionCap);

  const { busy, formError, submit } = useModalForm(async () => {
    if (!numShares || numShares <= 0) throw new Error('Enter shares to trim.');
    if (numShares > p.shares + 1e-9) throw new Error(`Only ${p.shares} shares parked.`);
    if (!numPrice || numPrice <= 0) throw new Error('Enter the sale price.');
    if (feeNum < 0 || (proceeds > 0 && feeNum >= proceeds)) {
      throw new Error('Fees must be smaller than the gross proceeds.');
    }
    if (fund && (!Number(vooPrice) || Number(vooPrice) <= 0)) {
      throw new Error("Funding the challenge account needs that day's VOO price for the shadow purchase.");
    }
    if (overCap && contributionCap !== null) {
      const room = contributionStatus(contributed, contributionCap).remaining;
      throw new Error(
        `Rule 12: depositing ${formatCurrency(netProceeds)} would exceed the contribution cap — only ${money(room)} of room remains. Uncheck funding or trim less.`,
      );
    }
    await recordTrim({
      parkedId: p.id,
      shares: numShares,
      pricePerShare: numPrice,
      date,
      depositVooPrice: fund ? Number(vooPrice) : undefined,
      fees: feeNum > 0 ? feeNum : undefined,
    });
    onClose();
  });

  return (
    <Modal isOpen onClose={onClose} title={`Sell ${p.ticker} (${p.account})`}>
      <form onSubmit={submit} className="space-y-3">
        {neverTrimFuel && (
          <div className="flex gap-2 bg-red-50 text-red-700 rounded-md px-3 py-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{p.ticker} is never trim fuel — Rule 5. The conviction holds stay parked.</span>
          </div>
        )}
        {dipsShortTerm && !neverTrimFuel && (
          <div className="flex gap-2 bg-amber-50 text-amber-800 rounded-md px-3 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              Only {fmtSh(summ.unlockedShares)} of {fmtSh(summ.totalShares)} sh are long-term.
              Trimming {fmtSh(numShares)} dips into short-term{summ.unknownShares > 0 ? ' or undated' : ''} lots —
              short-term rates, and Rule 5 says planned long-term trims.
              {summ.nextUnlock && ` Next ${fmtSh(summ.nextUnlock.shares)} sh unlock ${summ.nextUnlock.date}.`}
            </span>
          </div>
        )}
        {summ.unlockedShares > 0 && !dipsShortTerm && numShares > 0 && (
          <p className="text-xs text-green-700">
            Within the long-term shares ({fmtSh(summ.unlockedShares)} sh unlocked) — legitimate Rule 5 fuel.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={
            <span className="flex items-baseline justify-between gap-2">
              <span>Shares (of {fmtSh(p.shares)})</span>
              {!fullTrim && (
                <button type="button" onClick={() => setShares(String(p.shares))}
                  className="text-[11px] font-semibold normal-case text-green-700 hover:underline">
                  Sell all
                </button>
              )}
            </span>
          }>
            <input type="number" step="any" min="0.00000001" required value={shares}
              onChange={(e) => setShares(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Price / share ($)">
            <input type="number" step="any" min="0.00000001" required value={price}
              onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Date">
            <input type="date" required value={date} onChange={(e) => changeDate(e.target.value)} className={inputCls} />
          </Field>
          <TotalField value={total} onChange={setTotal} label="Total proceeds ($)" />
          <Field label="Fees ($, optional)">
            <input type="number" step="0.01" min="0" value={fees} placeholder="SEC/FINRA fees"
              onChange={(e) => setFees(e.target.value)} className={inputCls} />
          </Field>
          {feeNum > 0 && proceeds > 0 && (
            <p className="self-end pb-2 text-xs text-gray-500 tabular-nums">
              net proceeds {formatCurrency(netProceeds)}
            </p>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={fund} onChange={(e) => setFund(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600" />
          Deposit the proceeds into the challenge account
        </label>
        {fund && (
          <Field label={`VOO price on ${date}`}>
            <input type="number" step="0.01" min="0.01" value={vooPrice}
              onChange={(e) => setVooPrice(e.target.value)} className={inputCls} placeholder="for the shadow purchase" />
            {vooPrefilled && (
              <p className="mt-0.5 text-xs text-gray-400">from the live quote — edit if the fill differed</p>
            )}
            {!vooPrefilled && date !== todayISO() && (
              <p className="mt-0.5 text-xs text-gray-400">
                {vooClose?.requested === date && vooPrice !== ''
                  ? `VOO close ${vooClose.actual === date ? 'that day' : `on ${vooClose.actual} (nearest session)`} — fetched; edit if needed`
                  : closeFailedFor === date
                    ? `couldn't fetch — look up VOO's close for ${date}`
                    : `backdated — fetching VOO's close for ${date}…`}
              </p>
            )}
          </Field>
        )}

        {proceeds > 0 && (
          <div className="bg-gray-50 rounded-md px-3 py-2 text-sm space-y-1">
            <p className="text-gray-600">
              Proceeds <span className="font-medium tabular-nums">{formatCurrency(netProceeds)}</span>
              {feeNum > 0 && <span className="text-gray-400"> (net of {formatCurrency(feeNum)} fees)</span>}
              {preview && (
                <>
                  {' '}· gain{' '}
                  <span className={cn('font-medium tabular-nums', preview.gain - feeNum >= 0 ? 'text-green-600' : 'text-red-600')}>
                    {money(preview.gain - feeNum)}
                  </span>
                  <span className="text-gray-400">
                    {preview.adjustedCostBasis < preview.costBasis - 0.005
                      ? ` (adjusted basis ${money(preview.adjustedCostBasis)} — ROC-reduced from ${money(preview.costBasis)})`
                      : ` (basis ${money(preview.costBasis)})`}
                  </span>
                </>
              )}
              {fullTrim && <span className="ml-2 text-gray-500">· sells the whole position — dividend history stays on the Income screen</span>}
            </p>
            {preview && (
              <p className="text-xs text-gray-500 tabular-nums">
                {fmtSh(preview.ltShares)} sh long-term
                {preview.stShares > 0 && ` · ${fmtSh(preview.stShares)} sh short-term`}
                {preview.unknownShares > 0 && ` · ${fmtSh(preview.unknownShares)} sh undated`}
                {preview.gain - feeNum > 0 && (
                  <span title={`Rough estimate (~${formatPercent(ltTaxRate, 0)} LT / ~${formatPercent(stTaxRate, 0)} ST — editable on Tax Reserve). The quarterly skim never covers pile sales — set this aside yourself.`}>
                    {' '}· est. tax {money(estimatedPileTax(preview.gain - feeNum, numShares, preview.ltShares + preview.unknownShares, ltTaxRate, stTaxRate))}
                  </span>
                )}
                {isLoss && !isCryptoTicker(p.ticker) && <span className="text-red-600 font-medium"> · loss — arms the 31-day wash-sale window</span>}
                {isLoss && isCryptoTicker(p.ticker) && <span className="text-gray-400"> · loss — crypto is exempt from wash-sale rules</span>}
              </p>
            )}
            <p className="text-xs text-gray-400">
              Recorded in the pile's sale history with basis and term
              {fund ? ', and the Deposit + shadow VOO twin hit the ledger.' : '. Nothing touches the challenge account.'}
              {' '}Sales are undoable from the history — lots and basis come back exactly.
            </p>
          </div>
        )}

        <FormError message={formError} />
        <ModalFooter busy={busy} label="Record sale" busyLabel="Recording…" />
      </form>
    </Modal>
  );
}
