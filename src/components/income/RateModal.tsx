import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { FormError, ModalFooter, useModalForm } from '../ui/useModalForm';
import { useData } from '../../contexts/DataContext';
import type { DividendFrequency, ParkedPosition } from '../../lib/engine';
import { inputCls } from '../../lib/utils';

const FREQUENCY_LABELS: Record<DividendFrequency, string> = {
  daily: 'daily',
  weekly: 'weekly',
  semimonthly: 'twice a month',
  monthly: 'monthly',
  quarterly: 'quarterly',
  semiannual: 'semiannual',
  annual: 'annual',
};

export function RateModal({ position: p, onClose }: { position: ParkedPosition; onClose: () => void }) {
  const { updateParked } = useData();
  const [rate, setRate] = useState(p.dividendRate != null ? String(p.dividendRate) : '');
  const [frequency, setFrequency] = useState<DividendFrequency>(p.dividendFrequency ?? 'quarterly');
  const [growth, setGrowth] = useState(
    p.dividendGrowthPct != null ? String(Math.round(p.dividendGrowthPct * 10000) / 100) : '',
  );

  const { busy, formError, submit } = useModalForm(async () => {
    const r = rate === '' ? null : Number(rate);
    if (r != null && (Number.isNaN(r) || r < 0)) throw new Error('Rate is annual dollars per share, ≥ 0.');
    const g = growth === '' ? null : Number(growth) / 100;
    if (g != null && (Number.isNaN(g) || g <= -1 || g >= 1)) {
      throw new Error('Growth is an annual percentage between -99 and 99.');
    }
    await updateParked(p.id, {
      dividendRate: r,
      dividendFrequency: r == null ? null : frequency,
      // Clearing the rate retires its projection companions too — a stale
      // growth assumption must not keep compounding actual-history income.
      dividendGrowthPct: r == null ? null : g,
    });
    onClose();
  });

  return (
    <Modal isOpen onClose={onClose} title={`${p.ticker} dividend rate`}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Annual rate ($/share)">
            <input type="number" step="any" min="0" value={rate} autoFocus
              onChange={(e) => setRate(e.target.value)} className={inputCls} placeholder="e.g. 2.48" />
          </Field>
          <Field label="Frequency">
            <select value={frequency} className={inputCls}
              onChange={(e) => setFrequency(e.target.value as DividendFrequency)}>
              {(Object.keys(FREQUENCY_LABELS) as DividendFrequency[]).map((f) => (
                <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>
              ))}
            </select>
          </Field>
          <Field label="Div growth (%/yr)">
            <input type="number" step="any" value={growth}
              onChange={(e) => setGrowth(e.target.value)} className={inputCls}
              placeholder="for projections" title="Assumed annual dividend growth — used by the Transition modeler." />
          </Field>
        </div>
        <p className="text-xs text-gray-400">
          A manual estimate for projections until real payments build a history — actuals take over
          automatically once two dated payments exist. Clear the rate to exclude the holding.
        </p>
        <FormError message={formError} />
        <ModalFooter busy={busy} label="Save" onCancel={onClose} />
      </form>
    </Modal>
  );
}
