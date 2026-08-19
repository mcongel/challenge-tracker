import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { AccountSelect } from '../ui/AccountSelect';
import { useData } from '../../contexts/DataContext';
import type { ParkedPosition } from '../../lib/engine';
import { fetchProfile } from '../../lib/quotes';
import { errorMessage, formatCurrency, inputCls, labelCls, primaryBtnCls } from '../../lib/utils';
import { CATEGORY_SUGGESTIONS } from './shared';

export function EditParkedModal({
  position: p, onClose, accountKinds = ['outside', 'challenge'],
}: {
  position: ParkedPosition;
  onClose: () => void;
  /** Which kinds the account picker offers — ['retirement'] on that page. */
  accountKinds?: ('outside' | 'challenge' | 'retirement')[];
}) {
  const { updateParked, accounts, overrides, overrideSetAt, setOverride, clearOverride } = useData();
  const pinned = overrides[p.ticker];
  const pinnedAt = overrideSetAt[p.ticker];
  const [price, setPrice] = useState(String(p.currentPrice || ''));
  const [trimRank, setTrimRank] = useState(p.trimRank != null ? String(p.trimRank) : '');
  const [category, setCategory] = useState<ParkedPosition['category']>(p.category);
  const [accountId, setAccountId] = useState(p.accountId);
  const [liveQuotes, setLiveQuotes] = useState(p.liveQuotes ?? false);
  const [notes, setNotes] = useState(p.notes ?? '');
  // Pile rows always quote; the choice only exists on the retirement page,
  // where plan codes and annuity units must stay hand-priced.
  const offerLiveQuotes = accountKinds.includes('retirement');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Vendor industry as a reference while re-categorizing (hint, never auto).
  const [industry, setIndustry] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchProfile(p.ticker).then((r) => {
      if (!cancelled && r) setIndustry(r.industry);
    });
    return () => { cancelled = true; };
  }, [p.ticker]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      await updateParked(p.id, {
        currentPrice: Number(price) || 0,
        trimRank: trimRank === '' ? null : Number(trimRank),
        category,
        accountId,
        ...(offerLiveQuotes ? { liveQuotes } : {}),
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
    <Modal isOpen onClose={onClose} title={`Edit ${p.ticker} (${p.account})`}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Price ($)</label>
            {/* step=any: unit values carry 4 decimals (75.8888) */}
            <input type="number" step="any" min="0" value={price}
              onChange={(e) => setPrice(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Trim rank</label>
            <input type="number" min="1" step="1" value={trimRank}
              onChange={(e) => setTrimRank(e.target.value)} className={inputCls} placeholder="1 = trim first" />
          </div>
          <div>
            <label className={labelCls}>Sector</label>
            <input list="sector-suggestions-edit" value={category} className={inputCls}
              onChange={(e) => setCategory(e.target.value)} />
            <datalist id="sector-suggestions-edit">
              {CATEGORY_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
              {industry && !CATEGORY_SUGGESTIONS.includes(industry) && <option value={industry} />}
            </datalist>
            <p className="mt-0.5 text-xs text-gray-400"
              title="Vendor sector (Finnhub) — the default, not the law. Semiconductors drives the concentration cap; BTC marks the never-trim bucket.">
              vendor: {industry ?? 'none'}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-gray-400">
          <span>
            {pinned != null
              ? `Pinned at ${formatCurrency(pinned)}${pinnedAt ? ` since ${pinnedAt.slice(0, 10)}` : ''} — beats quotes until cleared.`
              : 'Pinning beats API quotes until cleared — for tickers the feed misprices.'}
          </span>
          <span className="flex gap-2 whitespace-nowrap">
            {pinned != null && (
              <button
                type="button"
                disabled={busy}
                className="font-medium text-red-600 hover:text-red-800"
                onClick={async () => {
                  setBusy(true);
                  try { await clearOverride(p.ticker); } catch (err) {
                    setFormError(errorMessage(err));
                  } finally { setBusy(false); }
                }}
              >
                Clear pin
              </button>
            )}
            <button
              type="button"
              disabled={busy || !Number(price)}
              className="font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
              onClick={async () => {
                setBusy(true);
                try { await setOverride(p.ticker, Number(price)); } catch (err) {
                  setFormError(errorMessage(err));
                } finally { setBusy(false); }
              }}
            >
              Pin this price
            </button>
          </span>
        </div>
        {offerLiveQuotes && (
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={liveQuotes} onChange={(e) => setLiveQuotes(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600" />
            <span>
              Real ticker — price from the daily quote feed
              <span className="block text-xs text-gray-400">
                Only for actual fund tickers (JLGMX). Leave off for plan codes and annuity
                units (W146, TRAD) — the market prices a different thing under those letters.
              </span>
            </span>
          </label>
        )}
        <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId}
          label="Account (e.g. after an ACATS transfer)" kinds={accountKinds} allowNone={false} />
        <p className="text-xs text-gray-400">
          Shares, cost, and dates live in the lots (click the row to open them) — they recompute from there.
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
