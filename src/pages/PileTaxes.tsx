import { useMemo, useState } from 'react';
import { Receipt, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorCard } from '../components/ui/ErrorCard';
import { SkeletonTable } from '../components/ui/SkeletonTable';
import { Card } from '../components/ui/Card';
import { StatTile, toneOf } from '../components/ui/StatTile';
import { FormError, useModalForm } from '../components/ui/useModalForm';
import { useData } from '../contexts/DataContext';
import type { PileTaxSetAside } from '../lib/engine';
import {
  dividendTaxForYear, pileCapGainsYear, roundCents, taxYearOf,
} from '../lib/engine';
import {
  cn, formatCurrency, formatPercent, inputCls, money, secondaryBtnCls, signedMoney, todayISO,
} from '../lib/utils';

/** The pile's yearly tax bill and what's been parked against it. Estimate +
 * ledger only — deliberately NOT the Tax Reserve screen: that's the
 * challenge account's non-negotiable 30% skim, and the two never mix. */
export function PileTaxes() {
  const {
    taxableParked, retirementAccountIds, parkedLots: allLots, parkedSales: allSales,
    dividendTaxRates, ltTaxRate, stTaxRate,
    pileTaxSetAsides, addPileTaxSetAside, deletePileTaxSetAside, loading, error,
  } = useData();
  const today = todayISO();
  // Taxable only: retirement sales and dividends are tax-sheltered — they
  // never belong in this estimate. The bitcoin bucket stays IN: its wall is
  // strategy, not tax.
  const parkedSales = useMemo(
    () => allSales.filter((s) => !retirementAccountIds.has(s.accountId)),
    [allSales, retirementAccountIds],
  );
  const parkedLots = useMemo(() => {
    const taxableIds = new Set(taxableParked.map((p) => p.id));
    return allLots.filter((l) => taxableIds.has(l.parkedPositionId));
  }, [allLots, taxableParked]);

  const [pileYear, setPileYear] = useState(taxYearOf(today));
  const pileYearOptions = useMemo(() => {
    const years = new Set<number>([taxYearOf(today)]);
    for (const s of parkedSales) years.add(taxYearOf(s.date));
    for (const l of parkedLots) if (l.source === 'dividend' && l.date) years.add(taxYearOf(l.date));
    for (const s of pileTaxSetAsides) years.add(s.taxYear);
    return [...years].sort((a, b) => b - a);
  }, [parkedSales, parkedLots, pileTaxSetAsides, today]);

  const capGains = useMemo(
    () => pileCapGainsYear(parkedSales, pileYear, ltTaxRate, stTaxRate),
    [parkedSales, pileYear, ltTaxRate, stTaxRate],
  );
  const divTax = useMemo(
    () => dividendTaxForYear(parkedLots, pileYear, today, dividendTaxRates),
    [parkedLots, pileYear, today, dividendTaxRates],
  );
  const divAmount = useMemo(
    () => Object.values(divTax.byClassification).reduce((t, e) => t + e.amount, 0),
    [divTax],
  );
  const setAsideTarget = roundCents(capGains.estTax + divTax.totalTax);

  const yearSetAsides = useMemo(
    () => pileTaxSetAsides.filter((s) => s.taxYear === pileYear),
    [pileTaxSetAsides, pileYear],
  );
  const recorded = roundCents(yearSetAsides.reduce((t, s) => t + s.amount, 0));
  const remaining = roundCents(setAsideTarget - recorded);

  // Record form — inline, this page IS the ledger.
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [deleting, setDeleting] = useState<PileTaxSetAside | null>(null);

  const netGain = capGains.ltGain + capGains.stGain;
  const anythingThisYear = capGains.saleCount > 0 || capGains.unknownBasisCount > 0
    || divAmount > 0 || yearSetAsides.length > 0;

  // Saving keeps the form on the page (it IS the ledger) and just clears it.
  const { busy, formError, submit } = useModalForm(async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) throw new Error('Enter the dollars you moved aside.');
    await addPileTaxSetAside({ taxYear: pileYear, date, amount: roundCents(amt), notes: notes || null });
    setAmount(''); setNotes('');
  });

  return (
    <div>
      <PageHeader
        title="Pile Taxes"
        subtitle="What the pile's sales and dividends owe, and what you've parked against it. Estimate only — the challenge account's 30% skim never covers the pile."
        actions={
          <select value={pileYear} onChange={(e) => setPileYear(Number(e.target.value))}
            className={cn(inputCls, 'w-auto')} aria-label="Tax year">
            {pileYearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        }
      />

      {error && <ErrorCard message={error} />}

      {loading ? (
        <SkeletonTable />
      ) : !anythingThisYear ? (
        <EmptyState
          icon={Receipt}
          title={`Nothing taxable in ${pileYear}`}
          hint="Pile sales with a recorded basis and dated dividends land here by tax year. Pick another year above, or come back after the first sale or payment."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <StatTile label="Realized sales"
              value={capGains.saleCount > 0 ? signedMoney(netGain) : '—'}
              tone={capGains.saleCount > 0 ? toneOf(netGain) : undefined}
              sub={
                <span className="tabular-nums">
                  {capGains.saleCount > 0
                    ? `LT ${formatCurrency(capGains.ltGain)} · ST ${formatCurrency(capGains.stGain)} · est. tax ${formatCurrency(capGains.estTax)}`
                    : 'no sales with basis this year'}
                  {capGains.unknownBasisCount > 0 && ` · ${capGains.unknownBasisCount} unknown-basis excluded`}
                </span>
              } />
            <StatTile label="Dividends"
              value={divAmount > 0 ? money(divAmount) : '—'}
              sub={
                <span className="tabular-nums">
                  {divAmount > 0 ? `est. tax ${money(divTax.totalTax)}` : 'none this year'}
                  {divTax.unclassifiedAmount > 0 && (
                    <span className="text-amber-700"> · {money(divTax.unclassifiedAmount)} unclassified</span>
                  )}
                  {divTax.rocOverflowAmount > 0 && (
                    <span> · ROC beyond basis {money(divTax.rocOverflowAmount)}</span>
                  )}
                </span>
              } />
            <StatTile label={`Set aside for ${pileYear}`}
              value={formatCurrency(setAsideTarget)}
              sub={
                <span className={cn('tabular-nums',
                  recorded <= 0 ? 'text-gray-400' : remaining <= 0.005 ? 'text-green-600 font-medium' : 'text-amber-700')}>
                  {recorded <= 0
                    ? 'nothing parked yet — record below'
                    : remaining <= 0.005
                      ? `✓ ${formatCurrency(recorded)} parked — covered`
                      : `${formatCurrency(recorded)} parked · ${formatCurrency(remaining)} short`}
                </span>
              } />
          </div>

          {/* The ledger: what actually moved. Estimates ask; this records. */}
          <Card className="p-4 sm:p-6 density-aware-card mb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
              Set-asides — {pileYear}
            </p>
            {yearSetAsides.length > 0 ? (
              <div className="max-h-56 overflow-y-auto rounded-md border border-gray-200 mb-3">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {[...yearSetAsides].reverse().map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5 tabular-nums text-gray-500 w-24">{s.date}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium text-green-600 w-28">
                          {formatCurrency(s.amount)}
                        </td>
                        <td className="px-3 py-1.5 text-gray-400 text-xs truncate">{s.notes}</td>
                        <td className="px-1 py-1.5 w-8">
                          <button onClick={() => setDeleting(s)} className="p-2 sm:p-1 rounded hover:bg-red-50" aria-label="Delete set-aside">
                            <Trash2 className="h-3.5 w-3.5 text-gray-300 hover:text-red-600" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-400 mb-3">Nothing recorded for {pileYear} yet.</p>
            )}

            <form onSubmit={submit} className="space-y-2">
              <p className="text-xs font-medium text-gray-500">Record a set-aside</p>
              <div className="grid grid-cols-2 gap-2">
                <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
                <input type="number" step="0.01" min="0.01" required value={amount}
                  placeholder={remaining > 0.005 ? `$ (${formatCurrency(remaining)} short)` : '$'}
                  onChange={(e) => setAmount(e.target.value)} className={inputCls} />
              </div>
              <div className="flex gap-2">
                <input value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="where it's parked (e.g. Key Bank savings)" className={inputCls} />
                <button type="submit" disabled={busy} className={secondaryBtnCls}>Add</button>
              </div>
              <FormError message={formError} />
            </form>
            <p className="text-xs text-gray-400 mt-3">
              A record of money you actually moved — nothing transfers automatically, and this
              never touches the challenge account's reserve.
            </p>
          </Card>

          <p className="text-xs text-gray-400">
            Estimated at ~{formatPercent(ltTaxRate, 0)} LT / ~{formatPercent(stTaxRate, 0)} ST
            (edit on Tax Reserve — rates are shared with the trim previews). LT/ST split follows
            each sale's recorded long-term shares; undated lots assume LT. Dividend estimates use
            the classification rates; ROC taxes 0 while basis remains. A net loss owes nothing
            here — wash-sale disallowances and loss carryover aren't modeled.
          </p>
        </>
      )}

      {deleting && (
        <ConfirmModal
          title="Delete set-aside record"
          message={`Delete the ${deleting.date} set-aside (${formatCurrency(deleting.amount)})? Only the record goes — move the real money back yourself if it shouldn't be parked.`}
          onConfirm={() => deletePileTaxSetAside(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
