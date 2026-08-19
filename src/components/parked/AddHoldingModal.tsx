import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { AccountSelect } from '../ui/AccountSelect';
import { TotalField } from '../ui/TotalField';
import { useData } from '../../contexts/DataContext';
import type { ParkedPosition } from '../../lib/engine';
import { isArchivedPosition, isCryptoTicker, roundCents, suggestCategory } from '../../lib/engine';
import { useNotional } from '../../lib/useNotional';
import { fetchProfile } from '../../lib/quotes';
import { cn, inputCls, labelCls, primaryBtnCls } from '../../lib/utils';
import { CATEGORY_SUGGESTIONS, fmtSh } from './shared';

export function AddHoldingModal({
  onClose, kinds = ['outside'],
}: {
  onClose: () => void;
  /** Which account kinds the Buy can land in — ['retirement'] on that page. */
  kinds?: ('outside' | 'retirement')[];
}) {
  const { accounts, parked, addParkedPosition, addParkedLot } = useData();
  const eligible = accounts.filter((a) => (kinds as string[]).includes(a.kind));
  const [ticker, setTicker] = useState('');
  const [accountId, setAccountId] = useState(eligible[0]?.id ?? '');
  const [category, setCategory] = useState<ParkedPosition['category']>('Other');
  const [date, setDate] = useState('');
  const { shares, price, total, setShares, setPrice, setTotal } = useNotional();
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Category help: the vendor industry shows as a hint, and unambiguous
  // industries (semis, crypto) pre-select — but a hand-picked category is
  // never overridden. Categories are strategy buckets, not sectors.
  const [industry, setIndustry] = useState<string | null>(null);
  const categoryTouched = useRef(false);
  const profileFetchedFor = useRef<string | null>(null);
  useEffect(() => {
    const t = ticker.trim().toUpperCase();
    // Crypto never resolves a vendor profile — categorize it directly.
    if (isCryptoTicker(t)) {
      if (!categoryTouched.current) setCategory('BTC');
      return;
    }
    if (!/^[A-Z.\-]{1,10}$/.test(t) || profileFetchedFor.current === t) return;
    const timer = setTimeout(() => {
      profileFetchedFor.current = t;
      void fetchProfile(t).then((p) => {
        if (!p) return;
        setIndustry(p.industry);
        const suggested = suggestCategory(p.industry);
        if (suggested && !categoryTouched.current) setCategory(suggested);
      });
    }, 500); // debounce typing
    return () => clearTimeout(timer);
  }, [ticker]);

  // Buying more of something already held merges as a new purchase lot; the
  // existing position's category wins. (Archived matches go through the
  // revive path in addParkedPosition instead.)
  const existing = parked.find(
    (p) => p.ticker === ticker.trim().toUpperCase() && p.accountId === accountId,
  );
  const liveMatch = existing && !isArchivedPosition(existing) ? existing : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const t = ticker.trim().toUpperCase();
    const sh = Number(shares);
    const pr = Number(price);
    if (!sh || sh <= 0 || !pr || pr <= 0) return setFormError('Enter shares and cost per share.');
    setBusy(true);
    try {
      if (liveMatch) {
        await addParkedLot({
          parkedPositionId: liveMatch.id,
          date: date || null,
          source: 'purchase',
          shares: sh,
          price: pr,
          amount: roundCents(sh * pr),
          notes: notes || null,
        });
      } else {
        await addParkedPosition({
          ticker: t,
          accountId,
          category: category.trim() || 'Other',
          date: date || null,
          shares: sh,
          price: pr,
          notes: notes || null,
        });
      }
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Buy — parked pile">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Ticker</label>
            <input required value={ticker} onChange={(e) => setTicker(e.target.value)}
              className={inputCls} placeholder="NVDA" />
          </div>
          <div>
            <label className={labelCls}>Sector</label>
            <input
              list="sector-suggestions"
              value={liveMatch ? liveMatch.category : category}
              disabled={Boolean(liveMatch)}
              onChange={(e) => { categoryTouched.current = true; setCategory(e.target.value); }}
              className={cn(inputCls, liveMatch && 'opacity-60')}
              placeholder="auto from ticker"
            />
            <datalist id="sector-suggestions">
              {CATEGORY_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
              {industry && !CATEGORY_SUGGESTIONS.includes(industry) && <option value={industry} />}
            </datalist>
            {industry && !liveMatch && (
              <p className="mt-0.5 text-xs text-gray-400" title="Vendor sector (Finnhub) — the default, not the law. Semiconductors drives the cap; BTC marks the never-trim bucket.">
                vendor: {industry}
              </p>
            )}
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Buy date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
        </div>
        {liveMatch && (
          <p className="text-xs text-sky-700 bg-sky-50 rounded-md px-3 py-2">
            {liveMatch.ticker} is already held in this account — this buy adds a purchase lot to
            the existing position ({fmtSh(liveMatch.shares)} sh held).
          </p>
        )}
        <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId}
          label="Account" kinds={kinds} allowNone={false} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Shares</label>
            <input type="number" step="any" min="0.00000001" required value={shares}
              onChange={(e) => setShares(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Cost per share ($)</label>
            <input type="number" step="any" min="0" required value={price}
              onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </div>
          <TotalField value={total} onChange={setTotal} label="Total cost ($)" />
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        <p className="text-xs text-gray-400">
          Each buy is its own dated lot with its own 366-day unlock clock. Dividends go in from
          the row's lot panel. Context only — never in the score.
        </p>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primaryBtnCls}>
            {busy ? 'Buying…' : 'Buy'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
