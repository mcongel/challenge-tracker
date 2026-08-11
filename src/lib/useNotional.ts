import { useState } from 'react';
import { roundCents } from './engine';

/** Two-way shares × price ↔ total binding for trade forms. Shares is the
 * pivot; whichever of price/total was typed last drives the other. Entering
 * the broker's filled notional derives the per-share price at FULL precision,
 * so every stored amount (roundCents(shares × price)) reproduces the notional
 * to the cent — rounded per-share prices drift on fractional shares. */
export function useNotional(initial?: { shares?: string; price?: string; total?: string }) {
  const [shares, setSharesState] = useState(initial?.shares ?? '');
  const [price, setPriceState] = useState(initial?.price ?? '');
  const [total, setTotalState] = useState(() => {
    if (initial?.total) return initial.total;
    const s = Number(initial?.shares);
    const p = Number(initial?.price);
    return s > 0 && p > 0 ? String(roundCents(s * p)) : '';
  });
  const [driver, setDriver] = useState<'price' | 'total'>('price');

  const setPrice = (pr: string, sh = shares) => {
    setPriceState(pr);
    setDriver('price');
    const p = Number(pr);
    const s = Number(sh);
    if (p > 0 && s > 0) setTotalState(String(roundCents(s * p)));
  };
  const setTotal = (t: string, sh = shares) => {
    setTotalState(t);
    setDriver('total');
    const tot = Number(t);
    const s = Number(sh);
    if (tot > 0 && s > 0) setPriceState(String(tot / s));
  };
  const setShares = (sh: string) => {
    setSharesState(sh);
    const s = Number(sh);
    if (driver === 'price') {
      const p = Number(price);
      if (p > 0 && s > 0) setTotalState(String(roundCents(s * p)));
    } else {
      const t = Number(total);
      if (t > 0 && s > 0) setPriceState(String(t / s));
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
