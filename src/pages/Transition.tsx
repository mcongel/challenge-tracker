import { useCallback, useMemo, useState } from 'react';
import { Copy, Pencil, Plus, Sunrise, Trash2 } from 'lucide-react';
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorCard } from '../components/ui/ErrorCard';
import { SkeletonTable } from '../components/ui/SkeletonTable';
import { useData } from '../contexts/DataContext';
import type { IncomeScenario, ScenarioProjection, ScenarioRotation } from '../lib/engine';
import { isArchivedPosition, projectScenario, roundCents } from '../lib/engine';
import {
  cn, compactUsd, errorMessage, formatCurrency, formatPercent, inputCls, inputToPct, labelCls,
  pctToInput, primaryBtnCls, secondaryBtnCls, todayISO,
} from '../lib/utils';
import { useChartColors } from '../lib/useIsDark';

/** House palette only: existing holdings in green tints, rotation buys in
 * indigo tints — the established actual/projected semantic, no new hues. */
const GREENS = ['#16a34a', '#22c55e', '#4ade80', '#86efac', '#bbf7d0'];
const INDIGOS = ['#4f46e5', '#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe'];

const WARNING_LABELS: Record<string, { label: string; cls: string; title: string }> = {
  short_term: {
    label: 'short-term', cls: 'bg-amber-50 text-amber-800',
    title: "Sells shares before their 366-day unlock — taxed at the short-term rate and against the funding rules' spirit. Warned, never blocked.",
  },
  oversell_clamped: {
    label: 'clamped', cls: 'bg-amber-50 text-amber-800',
    title: 'Asked for more shares than remain after earlier rotations — clamped to what is left.',
  },
  no_lots: {
    label: 'no lots', cls: 'bg-gray-100 text-gray-600',
    title: 'No lot history — basis estimated from avg cost, term assumed long.',
  },
  holding_missing: {
    label: 'missing', cls: 'bg-red-50 text-red-700',
    title: 'The holding no longer exists — this rotation is skipped.',
  },
  beyond_horizon: {
    label: 'beyond horizon', cls: 'bg-gray-100 text-gray-600',
    title: 'Dated after the projection horizon — contributes nothing visible.',
  },
};

export function Transition() {
  const {
    // Taxable universe incl. the bitcoin bucket — transition-era rotations
    // may sell anything taxable, and BTCI's income counts toward the ladder.
    incomeScenarios, scenarioRotations, taxableParked: parked, parkedLots, parkedLotAdjustments,
    dividendTaxRates, ltTaxRate, stTaxRate,
    addScenario, updateScenario, deleteScenario, duplicateScenario, deleteRotation,
    loading, error,
  } = useData();
  const today = todayISO();
  const settings = useMemo(
    () => ({ dividend: dividendTaxRates, lt: ltTaxRate, st: stTaxRate }),
    [dividendTaxRates, ltTaxRate, stTaxRate],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const selected =
    incomeScenarios.find((s) => s.id === selectedId) ??
    incomeScenarios.find((s) => s.isActive) ??
    incomeScenarios[0] ??
    null;
  const comparator = incomeScenarios.find((s) => s.id === compareId && s.id !== selected?.id) ?? null;

  const project = useCallback(
    (scenario: IncomeScenario): ScenarioProjection =>
      projectScenario({
        scenario,
        rotations: scenarioRotations.filter((r) => r.scenarioId === scenario.id),
        positions: parked,
        lots: parkedLots,
        adjustments: parkedLotAdjustments,
        today,
        settings,
      }),
    [scenarioRotations, parked, parkedLots, parkedLotAdjustments, today, settings],
  );
  // All scenarios project in one pass — the list's "Reached" column answers
  // the whole point of having several scenarios without clicking each one.
  const projectionsById = useMemo(
    () => new Map(incomeScenarios.map((s) => [s.id, project(s)])),
    [incomeScenarios, project],
  );
  const projection = selected ? projectionsById.get(selected.id) ?? null : null;
  const compareProjection = comparator ? projectionsById.get(comparator.id) ?? null : null;

  const [scenarioModal, setScenarioModal] = useState<'new' | IncomeScenario | null>(null);
  const [rotationModal, setRotationModal] = useState<'new' | ScenarioRotation | null>(null);
  const [deletingScenario, setDeletingScenario] = useState<IncomeScenario | null>(null);
  const [deletingRotation, setDeletingRotation] = useState<ScenarioRotation | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const selectedRotations = useMemo(
    () => (selected ? scenarioRotations.filter((r) => r.scenarioId === selected.id) : []),
    [selected, scenarioRotations],
  );
  const previewById = useMemo(
    () => new Map(projection?.rotationPreviews.map((p) => [p.rotationId, p]) ?? []),
    [projection],
  );

  return (
    <div>
      <PageHeader
        title="Transition"
        subtitle="What-if rotations from growth into income for the retirement window. Pure pile context — nothing here touches the score, the ratchet, or the skim."
        actions={
          <button onClick={() => setScenarioModal('new')}
            className={cn(primaryBtnCls, 'flex items-center gap-1.5')}>
            <Plus className="h-4 w-4" /> New scenario
          </button>
        }
      />

      {error && <ErrorCard message={error} />}
      {rowError && <ErrorCard message={rowError} />}

      {loading ? (
        <SkeletonTable />
      ) : incomeScenarios.length === 0 ? (
        <EmptyState
          icon={Sunrise}
          title="No scenarios yet"
          hint="A scenario is a plan: which holdings rotate into income assets, when, and at what assumed yields — projected against your target income and retirement year."
          action={
            <button onClick={() => setScenarioModal('new')} className={primaryBtnCls}>
              Create your first scenario
            </button>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-lg density-aware-card overflow-hidden">
            <table className="w-full text-sm compact-table">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-2">Scenario</th>
                  <th className="px-4 py-2 text-right">Target</th>
                  <th className="px-4 py-2">Reached</th>
                  <th className="px-4 py-2">Active</th>
                  <th className="px-2 py-2 w-28" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {incomeScenarios.map((s) => {
                  const isSelected = s.id === selected?.id;
                  const reached = projectionsById.get(s.id)?.targetReachedYear ?? null;
                  return (
                    <tr key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className={cn('cursor-pointer', isSelected ? 'bg-green-50/60' : 'hover:bg-gray-50')}>
                      <td className="px-4 py-2">
                        <span className="font-medium text-gray-900">{s.name}</span>
                        {s.description && <span className="ml-2 text-xs text-gray-400">{s.description}</span>}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                        {s.targetAnnualIncome != null ? `${formatCurrency(s.targetAnnualIncome)}/yr` : '—'}
                        {s.targetYear != null && <span className="text-xs text-gray-400"> by {s.targetYear}</span>}
                      </td>
                      <td className="px-4 py-2">
                        {s.targetAnnualIncome != null ? (
                          reached != null ? (
                            <span className="inline-block rounded-full bg-green-50 text-green-700 px-2 py-0.5 text-xs font-medium">
                              {reached} after-tax
                            </span>
                          ) : (
                            <span className="inline-block rounded-full bg-amber-50 text-amber-800 px-2 py-0.5 text-xs font-medium">
                              not in horizon
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={s.isActive}
                          onChange={(e) => updateScenario(s.id, { isActive: e.target.checked }).catch((err) => setRowError(errorMessage(err)))}
                          className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600" />
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setScenarioModal(s)} className="p-2 sm:p-1 rounded hover:bg-gray-100" aria-label="Edit scenario">
                          <Pencil className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                        </button>
                        <button onClick={() => duplicateScenario(s.id).catch((err) => setRowError(errorMessage(err)))}
                          className="p-2 sm:p-1 rounded hover:bg-gray-100" aria-label="Duplicate scenario">
                          <Copy className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                        </button>
                        <button onClick={() => setDeletingScenario(s)} className="p-2 sm:p-1 rounded hover:bg-red-50" aria-label="Delete scenario">
                          <Trash2 className="h-4 w-4 text-gray-300 hover:text-red-600" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected && projection && (
            <>
              <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 density-aware-card">
                <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {selected.name} — after-tax income by year
                  </p>
                  <label className="text-xs text-gray-500 flex items-center gap-2">
                    Compare with
                    <select
                      value={comparator?.id ?? ''}
                      onChange={(e) => setCompareId(e.target.value || null)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs">
                      <option value="">—</option>
                      {incomeScenarios.filter((s) => s.id !== selected.id).map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <ProjectionChart projection={projection} target={selected.targetAnnualIncome ?? null} />
                {comparator && compareProjection && (
                  <CompareChart
                    a={{ name: selected.name, projection }}
                    b={{ name: comparator.name, projection: compareProjection }}
                    target={selected.targetAnnualIncome ?? null}
                  />
                )}
                {Object.keys(projection.rocCumulativeBySymbol).length > 0 && (
                  <div className="mt-3 space-y-0.5">
                    {Object.entries(projection.rocCumulativeBySymbol).map(([sym, roc]) => {
                      const basis = projection.netProceedsBySymbol[sym] ?? 0;
                      return (
                        <p key={sym} className="text-xs text-gray-500">
                          {sym}: projected ROC through {projection.horizon.endYear} ≈{' '}
                          {formatCurrency(roundCents(roc))} of {formatCurrency(roundCents(basis))} basis
                          {basis > 0 && ` (${formatPercent(roc / basis, 0)})`} — ROC beyond basis becomes
                          capital gain.
                        </p>
                      );
                    })}
                  </div>
                )}
                {projection.excludedPositionIds.length > 0 && (
                  <p className="mt-2 text-xs text-amber-700">
                    Contributing $0 (no income history or manual rate):{' '}
                    {projection.excludedPositionIds
                      .map((id) => projection.holdingLabels[`pos:${id}`] ?? id)
                      .join(', ')}
                    {' '}— set rates on the Income screen to include them.
                  </p>
                )}
              </div>

              <div className="bg-white rounded-lg shadow-lg">
                <div className="px-4 pt-4 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Planned rotations
                  </p>
                  <button onClick={() => setRotationModal('new')}
                    className={cn(secondaryBtnCls, 'text-xs px-2.5 py-1')}>
                    Add rotation
                  </button>
                </div>
                {/* Only the table scrolls sideways — the toolbar above stays put. */}
                <div className="overflow-x-auto">
                <table className="w-full text-sm compact-table">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2">Sell</th>
                      <th className="px-4 py-2">Buy</th>
                      <th className="px-4 py-2 text-right">Net proceeds</th>
                      <th className="px-4 py-2 text-right">Est. tax</th>
                      <th className="px-4 py-2">Flags</th>
                      <th className="px-2 py-2 w-16" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {selectedRotations.map((r) => {
                      const pv = previewById.get(r.id);
                      const sellerLabel = r.sellHoldingId
                        ? projection.holdingLabels[`pos:${r.sellHoldingId}`] ?? '?'
                        : null;
                      return (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2 tabular-nums text-gray-500">{r.rotationDate}</td>
                          <td className="px-4 py-2">
                            {r.sellHoldingId ? (
                              <span className="font-medium text-gray-900">
                                {sellerLabel}
                                <span className="ml-1 text-xs text-gray-400">
                                  {r.sellShares != null ? `${r.sellShares} sh` : formatPercent(r.sellPct ?? 0, 0)}
                                </span>
                              </span>
                            ) : (
                              <span className="text-gray-600">new cash {formatCurrency(r.cashAmount ?? 0)}</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-gray-700">
                            {r.buySymbol.toUpperCase()}
                            <span className="ml-1 text-xs text-gray-400">@ {formatPercent(r.buyYieldPct)}</span>
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                            {pv ? formatCurrency(roundCents(pv.netProceeds)) : '—'}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                            {pv && pv.capitalGainsTax > 0 ? formatCurrency(roundCents(pv.capitalGainsTax)) : '—'}
                          </td>
                          <td className="px-4 py-2">
                            {(pv?.warnings ?? []).map((w) => {
                              const conf = WARNING_LABELS[w];
                              return conf ? (
                                <span key={w} title={conf.title}
                                  className={cn('mr-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium', conf.cls)}>
                                  {conf.label}
                                </span>
                              ) : null;
                            })}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <button onClick={() => setRotationModal(r)} className="p-2 sm:p-1 rounded hover:bg-gray-100" aria-label="Edit rotation">
                              <Pencil className="h-4 w-4 text-gray-300 hover:text-gray-600" />
                            </button>
                            <button onClick={() => setDeletingRotation(r)} className="p-2 sm:p-1 rounded hover:bg-red-50" aria-label="Delete rotation">
                              <Trash2 className="h-4 w-4 text-gray-300 hover:text-red-600" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {selectedRotations.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-sm text-gray-400 text-center">
                          No rotations yet — the projection shows today's holdings coasting as-is.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {scenarioModal && (
        <ScenarioFormModal
          scenario={scenarioModal === 'new' ? null : scenarioModal}
          onSave={async (values) => {
            if (scenarioModal === 'new') await addScenario({ ...values, isActive: incomeScenarios.length === 0 });
            else await updateScenario(scenarioModal.id, values);
          }}
          onClose={() => setScenarioModal(null)}
        />
      )}
      {rotationModal && selected && (
        <RotationFormModal
          scenarioId={selected.id}
          rotation={rotationModal === 'new' ? null : rotationModal}
          onClose={() => setRotationModal(null)}
        />
      )}
      {deletingScenario && (
        <ConfirmModal
          title="Delete scenario"
          message={`Delete "${deletingScenario.name}" and its ${scenarioRotations.filter((r) => r.scenarioId === deletingScenario.id).length} rotation(s)? This is a what-if — no real holdings change.`}
          onConfirm={() => deleteScenario(deletingScenario.id)}
          onClose={() => setDeletingScenario(null)}
        />
      )}
      {deletingRotation && (
        <ConfirmModal
          title="Delete rotation"
          message={`Remove the ${deletingRotation.buySymbol.toUpperCase()} rotation dated ${deletingRotation.rotationDate}?`}
          onConfirm={() => deleteRotation(deletingRotation.id)}
          onClose={() => setDeletingRotation(null)}
        />
      )}
    </div>
  );
}

function ProjectionChart({ projection, target }: { projection: ScenarioProjection; target: number | null }) {
  const { gridColor, axisColor } = useChartColors();

  const { data, posKeys, buyKeys } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const y of projection.years) {
      for (const [k, v] of Object.entries(y.byHoldingAfterTax)) {
        totals.set(k, (totals.get(k) ?? 0) + v);
      }
    }
    const keys = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    return {
      data: projection.years.map((y) => ({ year: String(y.year), ...y.byHoldingAfterTax })),
      posKeys: keys.filter((k) => k.startsWith('pos:')),
      buyKeys: keys.filter((k) => k.startsWith('buy:')),
    };
  }, [projection]);

  if (posKeys.length === 0 && buyKeys.length === 0) {
    return (
      <p className="text-xs text-gray-400 py-6 text-center">
        Nothing projects yet — holdings need income history or manual rates, or add a rotation.
      </p>
    );
  }
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={gridColor} vertical={false} />
          <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: axisColor }} />
          <YAxis tickFormatter={compactUsd} width={52} tickLine={false} axisLine={false}
            tick={{ fontSize: 11, fill: axisColor }} />
          <Tooltip
            formatter={(v, name) => [
              formatCurrency(Number(v)),
              projection.holdingLabels[String(name)] ?? String(name),
            ]}
          />
          {posKeys.map((k, i) => (
            <Bar key={k} dataKey={k} stackId="income" fill={GREENS[i % GREENS.length]}
              name={k} legendType="none" />
          ))}
          {buyKeys.map((k, i) => (
            <Bar key={k} dataKey={k} stackId="income" fill={INDIGOS[i % INDIGOS.length]}
              name={k} legendType="none" />
          ))}
          {target != null && (
            <ReferenceLine y={target} stroke={axisColor} strokeDasharray="4 4"
              label={{ value: 'target', fontSize: 10, fill: axisColor, position: 'insideTopRight' }} />
          )}
          {projection.targetReachedYear != null && (
            <ReferenceLine x={String(projection.targetReachedYear)} stroke="#16a34a" strokeDasharray="4 4" />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {projection.targetReachedYear != null && (
        <p className="text-xs text-green-700 mt-1">
          Target reached {projection.targetReachedYear} — after-tax. Green bars = today's holdings,
          indigo = rotation buys.
        </p>
      )}
    </div>
  );
}

function CompareChart({
  a, b, target,
}: {
  a: { name: string; projection: ScenarioProjection };
  b: { name: string; projection: ScenarioProjection };
  target: number | null;
}) {
  const { isDark, gridColor, axisColor } = useChartColors();
  const data = useMemo(() => {
    const years = new Map<number, { year: string; a?: number; b?: number }>();
    for (const y of a.projection.years) years.set(y.year, { year: String(y.year), a: y.afterTaxIncome });
    for (const y of b.projection.years) {
      const row = years.get(y.year) ?? { year: String(y.year) };
      row.b = y.afterTaxIncome;
      years.set(y.year, row);
    }
    return [...years.values()].sort((x, y) => x.year.localeCompare(y.year));
  }, [a.projection, b.projection]);

  return (
    <div className="h-44 mt-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
        After-tax totals — {a.name} vs {b.name}
      </p>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={gridColor} vertical={false} />
          <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: axisColor }} />
          <YAxis tickFormatter={compactUsd} width={52} tickLine={false} axisLine={false}
            tick={{ fontSize: 11, fill: axisColor }} />
          <Tooltip formatter={(v) => formatCurrency(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="a" name={a.name} stroke="#16a34a" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="b" name={b.name} stroke={isDark ? '#6366f1' : '#4f46e5'} strokeWidth={2} dot={false} />
          {target != null && <ReferenceLine y={target} stroke={axisColor} strokeDasharray="4 4" />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ScenarioFormModal({
  scenario, onSave, onClose,
}: {
  scenario: IncomeScenario | null;
  onSave: (values: Omit<IncomeScenario, 'id' | 'createdAt' | 'isActive'> & { isActive?: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const { dividendTaxRates, ltTaxRate } = useData();
  const settings = { dividend: dividendTaxRates, lt: ltTaxRate };
  const [name, setName] = useState(scenario?.name ?? '');
  const [description, setDescription] = useState(scenario?.description ?? '');
  const [target, setTarget] = useState(scenario?.targetAnnualIncome != null ? String(scenario.targetAnnualIncome) : '');
  const [targetYear, setTargetYear] = useState(scenario?.targetYear != null ? String(scenario.targetYear) : '');
  const [qualified, setQualified] = useState(pctToInput(scenario?.qualifiedRate));
  const [ordinary, setOrdinary] = useState(pctToInput(scenario?.ordinaryRate));
  const [capGain, setCapGain] = useState(pctToInput(scenario?.capitalGainRate));
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) return setFormError('Name the scenario.');
    if (target !== '' && !(Number(target) > 0)) {
      return setFormError('Target income must be above zero — leave it blank for no target.');
    }
    const rates = [inputToPct(qualified), inputToPct(ordinary), inputToPct(capGain)];
    if (rates.some((r) => r != null && (Number.isNaN(r) || r < 0 || r >= 1))) {
      return setFormError('Rates are percentages between 0 and 99.');
    }
    setBusy(true);
    try {
      await onSave({
        name: name.trim(),
        description: description || null,
        targetAnnualIncome: target === '' ? null : Number(target),
        targetYear: targetYear === '' ? null : Number(targetYear),
        qualifiedRate: rates[0],
        ordinaryRate: rates[1],
        capitalGainRate: rates[2],
      });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={scenario ? `Edit ${scenario.name}` : 'New scenario'}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Name</label>
            <input required value={name} onChange={(e) => setName(e.target.value)}
              className={inputCls} placeholder="Retire 2030" autoFocus />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Target income ($/yr, after-tax)</label>
            <input type="number" step="any" min="0" value={target}
              onChange={(e) => setTarget(e.target.value)} className={inputCls} placeholder="e.g. 40000" />
          </div>
          <div>
            <label className={labelCls}>Retirement year</label>
            <input type="number" step="1" min="2026" max="2100" value={targetYear}
              onChange={(e) => setTargetYear(e.target.value)} className={inputCls} placeholder="e.g. 2030" />
          </div>
        </div>
        <p className="text-xs font-medium text-gray-500 pt-1">
          Tax rates in this scenario — retired brackets usually differ from working ones. Blank uses
          the Tax Reserve settings.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Qualified (%)</label>
            <input type="number" step="any" min="0" max="99" value={qualified}
              onChange={(e) => setQualified(e.target.value)} className={inputCls}
              placeholder={`settings ${Math.round(settings.dividend.qualified * 100)}%`} />
          </div>
          <div>
            <label className={labelCls}>Ordinary (%)</label>
            <input type="number" step="any" min="0" max="99" value={ordinary}
              onChange={(e) => setOrdinary(e.target.value)} className={inputCls}
              placeholder={`settings ${Math.round(settings.dividend.ordinary * 100)}%`} />
          </div>
          <div>
            <label className={labelCls}>Capital gains LT (%)</label>
            <input type="number" step="any" min="0" max="99" value={capGain}
              onChange={(e) => setCapGain(e.target.value)} className={inputCls}
              placeholder={`settings ${Math.round(settings.lt * 100)}%`} />
          </div>
        </div>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryBtnCls}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function RotationFormModal({
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
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mixSum = Object.values(mix).map((x) => Number(x) || 0).reduce((a, b) => a + b, 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!symbol.trim()) return setFormError('Enter the income asset to buy.');
    const y = Number(yieldPct);
    if (!y || y <= 0) return setFormError('Enter the assumed starting yield.');
    if (Math.abs(mixSum - 100) > 0.01) return setFormError('The classification mix must total 100.');
    const isCash = source === 'cash';
    if (isCash && (!Number(cashAmount) || Number(cashAmount) <= 0)) {
      return setFormError('Enter the new-cash amount.');
    }
    if (!isCash && sellMode === 'pct' && (!Number(sellPct) || Number(sellPct) <= 0 || Number(sellPct) > 100)) {
      return setFormError('Percent to sell must be between 0 and 100.');
    }
    if (!isCash && sellMode === 'shares' && (!Number(sellShares) || Number(sellShares) <= 0)) {
      return setFormError('Enter the shares to sell.');
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
    setBusy(true);
    try {
      if (rotation) await updateRotation(rotation.id, payload);
      else await addRotation(payload);
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={rotation ? 'Edit rotation' : 'Add rotation'}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Source</label>
            <select value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}>
              <option value="cash">New cash</option>
              {sourceOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.ticker} ({p.account}, {p.shares} sh{isArchivedPosition(p) ? ' — closed' : ''})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Rotation date</label>
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
        </div>
        {source === 'cash' ? (
          <div>
            <label className={labelCls}>Cash amount ($)</label>
            <input type="number" step="any" min="0.01" value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)} className={inputCls} />
          </div>
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
              <div>
                <label className={labelCls}>Percent to sell</label>
                <input type="number" step="any" min="0.01" max="100" value={sellPct}
                  onChange={(e) => setSellPct(e.target.value)} className={inputCls} placeholder="e.g. 50" />
              </div>
            ) : (
              <div>
                <label className={labelCls}>Shares to sell</label>
                <input type="number" step="any" min="0.00000001" value={sellShares}
                  onChange={(e) => setSellShares(e.target.value)} className={inputCls} />
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Buy symbol</label>
            <input required value={symbol} onChange={(e) => setSymbol(e.target.value)}
              className={inputCls} placeholder="SCHD" />
          </div>
          <div>
            <label className={labelCls}>Starting yield (%)</label>
            <input type="number" step="any" min="0.01" required value={yieldPct}
              onChange={(e) => setYieldPct(e.target.value)} className={inputCls} placeholder="e.g. 3.5" />
          </div>
          <div>
            <label className={labelCls}>Div growth (%/yr)</label>
            <input type="number" step="any" value={growth}
              onChange={(e) => setGrowth(e.target.value)} className={inputCls} />
          </div>
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
        <div>
          <label className={labelCls}>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        {formError && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{formError}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryBtnCls}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
