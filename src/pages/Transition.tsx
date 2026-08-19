import { useCallback, useMemo, useState } from 'react';
import { Copy, Pencil, Plus, Sunrise, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorCard } from '../components/ui/ErrorCard';
import { SkeletonTable } from '../components/ui/SkeletonTable';
import { Card, TableCard, theadCls } from '../components/ui/Card';
import { ProjectionChart } from '../components/transition/ProjectionChart';
import { CompareChart } from '../components/transition/CompareChart';
import { ScenarioFormModal } from '../components/transition/ScenarioFormModal';
import { RotationFormModal } from '../components/transition/RotationFormModal';
import { useData } from '../contexts/DataContext';
import type { IncomeScenario, ScenarioProjection, ScenarioRotation } from '../lib/engine';
import { projectScenario } from '../lib/engine';
import {
  cn, errorMessage, formatCurrency, formatPercent,
  money, primaryBtnCls, secondaryBtnCls, todayISO,
} from '../lib/utils';

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
          <Card className="density-aware-card overflow-hidden">
            <table className="w-full text-sm compact-table">
              <thead className="bg-gray-50">
                <tr className={theadCls}>
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
          </Card>

          {selected && projection && (
            <>
              <Card className="p-4 sm:p-6 density-aware-card">
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
                          {money(roc)} of {money(basis)} basis
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
              </Card>

              {/* Only the table scrolls sideways — the toolbar above stays put. */}
              <TableCard
                toolbar={
                  <div className="px-4 pt-4 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                      Planned rotations
                    </p>
                    <button onClick={() => setRotationModal('new')}
                      className={cn(secondaryBtnCls, 'text-xs px-2.5 py-1')}>
                      Add rotation
                    </button>
                  </div>
                }
              >
                <table className="w-full text-sm compact-table">
                  <thead className="bg-gray-50">
                    <tr className={theadCls}>
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
                            {pv ? money(pv.netProceeds) : '—'}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                            {pv && pv.capitalGainsTax > 0 ? money(pv.capitalGainsTax) : '—'}
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
              </TableCard>
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
