import { useState } from 'react';
import { roundCents } from './engine';

/** Two-way shares × price ↔ total binding for trade forms. Shares is the
 * pivot; whichever of price/total was typed last drives the other. Entering
 * the broker's filled notional derives the per-share price at FULL precision,
 * so every stored amount (roundCents(shares × price)) reproduces the notional
 * to the cent — rounded per-share prices drift on fractional shares.
 *
 * When the driving field is blank/invalid, the derived field blanks too —
 * a stale derived value that no longer matches anything on screen is worse
 * than an empty one. */
export function useNotional(initial?: {
  shares?: string;
  price?: string;
  total?: string;
  /** Which field is authoritative at mount — pass 'total' when seeding from
   * stored exact dollars (e.g. a sale's proceeds) so share edits re-derive
   * the price from the exact total, not from a DB-rounded price. */
  driver?: 'price' | 'total';
}) {
  const [shares, setSharesState] = useState(initial?.shares ?? '');
  const [price, setPriceState] = useState(initial?.price ?? '');
  const [total, setTotalState] = useState(() => {
    if (initial?.total) return initial.total;
    const s = Number(initial?.shares);
    const p = Number(initial?.price);
    return s > 0 && p > 0 ? String(roundCents(s * p)) : '';
  });
  const [driver, setDriver] = useState<'price' | 'total'>(initial?.driver ?? 'price');

  const setPrice = (pr: string, sh = shares) => {
    setPriceState(pr);
    setDriver('price');
    const p = Number(pr);
    const s = Number(sh);
    setTotalState(p > 0 && s > 0 ? String(roundCents(s * p)) : '');
  };
  const setTotal = (t: string, sh = shares) => {
    setTotalState(t);
    setDriver('total');
    const tot = Number(t);
    const s = Number(sh);
    setPriceState(tot > 0 && s > 0 ? String(tot / s) : '');
  };
  const setShares = (sh: string) => {
    setSharesState(sh);
    const s = Number(sh);
    if (driver === 'price') {
      const p = Number(price);
      setTotalState(p > 0 && s > 0 ? String(roundCents(s * p)) : '');
    } else {
      const t = Number(total);
      setPriceState(t > 0 && s > 0 ? String(t / s) : '');
    }
  };
  const reset = () => {
    setSharesState('');
    setPriceState('');
    setTotalState('');
    setDriver('price');
  };
  return { shares, price, total, setShares, setPrice, setTotal, reset };
}
