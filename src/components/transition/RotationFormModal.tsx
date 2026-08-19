import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { FormError, ModalFooter, useModalForm } from '../ui/useModalForm';
import { useData } from '../../contexts/DataContext';
import type { ScenarioRotation } from '../../lib/engine';
import { isArchivedPosition } from '../../lib/engine';
import { cn, inputCls, labelCls, pctToInput, todayISO } from '../../lib/utils';

export function RotationFormModal({
  scenarioId, rotation, onClose,
}: {
  scenarioId: string;
  rotation: ScenarioRotation | null;
  onClose: () => void;
}) {
  const { taxableParked: parked, addRotation, updateRotation } = useData();
  const live = parked.filter((p) => !isArchivedPosition(p));
  // An existing rotation may reference a holding that has since been archived
  // — keep it selectable (labeled) so editing doesn't silently blank the source.
  const sourceOptions = useMemo(() => {
    const opts = [...live];
    if (rotation?.sellHoldingId && !live.some((p) => p.id === rotation.sellHoldingId)) {
      const archived = parked.find((p) => p.id === rotation.sellHoldingId);
      if (archived) opts.push(archived);
    }
    return opts;
  }, [live, parked, rotation]);
  const [source, setSource] = useState(rotation?.sellHoldingId ?? 'cash');
  const [sellMode, setSellMode] = useState<'pct' | 'shares'>(rotation?.sellShares != null ? 'shares' : 'pct');
  const [sellPct, setSellPct] = useState(pctToInput(rotation?.sellPct));
  const [sellShares, setSellShares] = useState(rotation?.sellShares != null ? String(rotation.sellShares) : '');
  const [cashAmount, setCashAmount] = useState(rotation?.cashAmount != null ? String(rotation.cashAmount) : '');
  const [date, setDate] = useState(rotation?.rotationDate ?? todayISO());
  const [symbol, setSymbol] = useState(rotation?.buySymbol ?? '');
  const [yieldPct, setYieldPct] = useState(rotation ? pctToInput(rotation.buyYieldPct) : '');
  const [growth, setGrowth] = useState(rotation ? pctToInput(rotation.buyDividendGrowthPct) : '0');
  const MIX_FIELDS = [
    ['qualified', 'Qualified'],
    ['ordinary', 'Ordinary'],
    ['return_of_capital', 'ROC'],
    ['capital_gain_dist', 'Cap gain'],
  ] as const;
  const [mix, setMix] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      MIX_FIELDS.map(([k]) => [
        k,
        String(rotation?.buyClassificationMix?.[k] ?? (k === 'qualified' && !rotation ? 100 : 0)),
      ]),
    ),
  );
  const [notes, setNotes] = useState(rotation?.notes ?? '');

  const mixSum = Object.values(mix).map((x) => Number(x) || 0).reduce((a, b) => a + b, 0);

  const { busy, formError, submit } = useModalForm(async () => {
    if (!symbol.trim()) throw new Error('Enter the income asset to buy.');
    const y = Number(yieldPct);
    if (!y || y <= 0) throw new Error('Enter the assumed starting yield.');
    if (Math.abs(mixSum - 100) > 0.01) throw new Error('The classification mix must total 100.');
    const isCash = source === 'cash';
    if (isCash && (!Number(cashAmount) || Number(cashAmount) <= 0)) {
      throw new Error('Enter the new-cash amount.');
    }
    if (!isCash && sellMode === 'pct' && (!Number(sellPct) || Number(sellPct) <= 0 || Number(sellPct) > 100)) {
      throw new Error('Percent to sell must be between 0 and 100.');
    }
    if (!isCash && sellMode === 'shares' && (!Number(sellShares) || Number(sellShares) <= 0)) {
      throw new Error('Enter the shares to sell.');
    }
    const payload: Omit<ScenarioRotation, 'id'> = {
      scenarioId,
      sellHoldingId: isCash ? null : source,
      sellShares: !isCash && sellMode === 'shares' ? Number(sellShares) : null,
      sellPct: !isCash && sellMode === 'pct' ? Number(sellPct) / 100 : null,
      cashAmount: isCash ? Number(cashAmount) : null,
      rotationDate: date,
      buySymbol: symbol.trim().toUpperCase(),
      buyYieldPct: y / 100,
      buyDividendGrowthPct: (Number(growth) || 0) / 100,
      buyClassificationMix: Object.fromEntries(
        Object.entries(mix)
          .map(([k, v]) => [k, Number(v) || 0] as const)
          .filter(([, v]) => v > 0),
      ),
      notes: notes || null,
    };
    if (rotation) await updateRotation(rotation.id, payload);
    else await addRotation(payload);
    onClose();
  });

  return (
    <Modal isOpen onClose={onClose} title={rotation ? 'Edit rotation' : 'Add rotation'}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Source">
            <select value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}>
              <option value="cash">New cash</option>
              {sourceOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.ticker} ({p.account}, {p.shares} sh{isArchivedPosition(p) ? ' — closed' : ''})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rotation date">
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
        </div>
        {source === 'cash' ? (
          <Field label="Cash amount ($)">
            <input type="number" step="any" min="0.01" value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)} className={inputCls} />
          </Field>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:items-end">
            <div className="flex gap-3 text-sm text-gray-600">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={sellMode === 'pct'} onChange={() => setSellMode('pct')}
                  className="h-4 w-4 border-gray-300 text-green-600 focus:ring-green-600" />
                % of holding
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={sellMode === 'shares'} onChange={() => setSellMode('shares')}
                  className="h-4 w-4 border-gray-300 text-green-600 focus:ring-green-600" />
                shares
              </label>
            </div>
            {sellMode === 'pct' ? (
              <Field label="Percent to sell">
                <input type="number" step="any" min="0.01" max="100" value={sellPct}
                  onChange={(e) => setSellPct(e.target.value)} className={inputCls} placeholder="e.g. 50" />
              </Field>
            ) : (
              <Field label="Shares to sell">
                <input type="number" step="any" min="0.00000001" value={sellShares}
                  onChange={(e) => setSellShares(e.target.value)} className={inputCls} />
              </Field>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Buy symbol">
            <input required value={symbol} onChange={(e) => setSymbol(e.target.value)}
              className={inputCls} placeholder="SCHD" />
          </Field>
          <Field label="Starting yield (%)">
            <input type="number" step="any" min="0.01" required value={yieldPct}
              onChange={(e) => setYieldPct(e.target.value)} className={inputCls} placeholder="e.g. 3.5" />
          </Field>
          <Field label="Div growth (%/yr)">
            <input type="number" step="any" value={growth}
              onChange={(e) => setGrowth(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div>
          <p className={cn(labelCls, 'flex items-center justify-between')}>
            <span>Distribution mix (% of payouts)</span>
            <span className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              Math.abs(mixSum - 100) <= 0.01 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800',
            )}>
              Σ {Math.round(mixSum * 100) / 100}
            </span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {MIX_FIELDS.map(([key, label]) => (
              <div key={key}>
                <label className="block text-[10px] text-gray-400 mb-0.5">{label}</label>
                <input type="number" step="any" min="0" max="100" value={mix[key]}
                  onChange={(e) => setMix((prev) => ({ ...prev, [key]: e.target.value }))}
                  className={inputCls} />
              </div>
            ))}
          </div>
        </div>
        <Field label="Notes">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </Field>
        <FormError message={formError} />
        <ModalFooter busy={busy} label="Save" onCancel={onClose} />
      </form>
    </Modal>
  );
}
