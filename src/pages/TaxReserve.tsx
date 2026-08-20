import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark, Scale, SlidersHorizontal, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { AccountSelect } from '../components/ui/AccountSelect';
import { ErrorCard } from '../components/ui/ErrorCard';
import { SkeletonTable } from '../components/ui/SkeletonTable';
import { TableCard, theadCls } from '../components/ui/Card';
import { RowCard, RowCardStat } from '../components/ui/RowCard';
import { Field } from '../components/ui/Field';
import { FormError, ModalFooter, useModalForm } from '../components/ui/useModalForm';
import { useData } from '../contexts/DataContext';
import {
  computeCheck, estimatedPileTax, formatQuarterLabel, quarterOf, quartersEnded,
  reservedByAccount, roundCents, taxYearOf,
} from '../lib/engine';
import {
  cn, errorMessage, inputCls, money, primaryBtnCls, secondaryBtnCls, todayISO,
} from '../lib/utils';

export function TaxReserve() {
  const {
    trades, cashEvents, carryforwards, accounts, parkedSales, ltTaxRate, stTaxRate,
    dividendTaxRates, updateSettings, loading, error,
  } = useData();
  const pileEstTax = parkedSales
    .filter((s) => s.costBasis != null)
    .reduce(
      (sum, s) =>
        sum + estimatedPileTax(s.proceeds - (s.costBasis as number), s.shares, s.ltShares, ltTaxRate, stTaxRate),
      0,
    );
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingSkim, setPendingSkim] = useState<{ label: string; amount: number } | null>(null);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [carryOpen, setCarryOpen] = useState(false);

  const today = todayISO();
  const firstDate = [...trades.map((t) => t.closeDate), ...cashEvents.map((e) => e.date)].sort()[0];
  const ended = firstDate
    ? quartersEnded(firstDate, today).map((q) => computeCheck(q, trades, cashEvents, carryforwards))
    : [];
  // The running quarter, shown as a preview so the number is never a surprise.
  const current = computeCheck(
    { year: taxYearOf(today), quarter: quarterOf(today) },
    trades, cashEvents, carryforwards,
  );
  const carryThisYear = carryforwards.find((c) => c.taxYear === taxYearOf(today));
  const heldIn = [...reservedByAccount(cashEvents)].filter(([, amount]) => amount > 0);

  return (
    <div>
      <PageHeader
        title="Tax Reserve"
        subtitle="Every quarter: 30% of net realized gains YTD moves out of play. Non-negotiable — it's what makes a blown account a shrug instead of a debt."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setCarryOpen(true)}
              className={cn(secondaryBtnCls, 'flex items-center gap-1.5')}
              title="Loss carried into a tax year — offsets gains before the 30% applies."
            >
              <Scale className="h-4 w-4" /> Carryforwards
            </button>
            <button
              onClick={() => setRatesOpen(true)}
              className={cn(secondaryBtnCls, 'flex items-center gap-1.5')}
              title="Rates used for informational estimates (pile gains, dividends) — never the 30% skim itself."
            >
              <SlidersHorizontal className="h-4 w-4" /> Estimate rates
            </button>
          </div>
        }
      />

      {error && <ErrorCard message={error} />}
      {rowError && <ErrorCard message={rowError} />}

      <p className="mb-4 -mt-2 text-xs text-gray-400">
        This screen is the challenge account only.{' '}
        <Link to="/pile-taxes" className="text-green-700 hover:underline">
          Pile taxes have their own page →
        </Link>
      </p>

      {carryThisYear && (
        <div className="mb-4 bg-sky-50 text-sky-800 rounded-lg px-4 py-3 text-sm">
          Loss carryforward into {carryThisYear.taxYear}: {money(carryThisYear.amount)} —
          offsets gains before the 30% applies.{' '}
          <button onClick={() => setCarryOpen(true)} className="underline hover:no-underline">
            Edit
          </button>
        </div>
      )}

      {loading ? (
        <SkeletonTable />
      ) : !firstDate ? (
        <EmptyState
          icon={Landmark}
          title="No quarters to settle yet"
          hint="The checklist starts once there's activity. Each quarter's number auto-computes from the Trade Log the day the quarter ends."
        />
      ) : (
        <TableCard
          cards={
            <>
              {[...ended].reverse().map((c) => {
                const label = formatQuarterLabel(c);
                const due = c.moveOutNow > 0;
                return (
                  <RowCard
                    key={label}
                    className={due ? 'bg-yellow-50' : undefined}
                    title={
                      <>
                        {label}
                        <span className="ml-2 text-xs font-normal text-gray-400">ended {c.endDate}</span>
                      </>
                    }
                    value={
                      <span className={due ? 'text-yellow-700' : 'text-gray-400'}>
                        {money(c.moveOutNow)}
                      </span>
                    }
                    actions={
                      due ? (
                        <button
                          onClick={() => setPendingSkim({ label, amount: c.moveOutNow })}
                          className={cn(primaryBtnCls, 'py-1 px-2.5 text-xs')}
                        >
                          {`Mark moved ${money(c.moveOutNow)}`}
                        </button>
                      ) : (
                        <span className="inline-block rounded-full bg-green-50 text-green-700 px-2 py-0.5 text-xs font-medium">
                          Settled
                        </span>
                      )
                    }
                  >
                    <RowCardStat label="Net realized YTD">{money(c.netRealizedYTD)}</RowCardStat>
                    <RowCardStat label="Target (30%)">{money(c.reserveTarget)}</RowCardStat>
                    <RowCardStat label="Already reserved">{money(c.alreadyReserved)}</RowCardStat>
                  </RowCard>
                );
              })}
              {/* The running quarter, muted like its table row — a preview, not a bill. */}
              <RowCard
                className="bg-gray-50"
                title={
                  <span className="text-gray-500">
                    {formatQuarterLabel(current)}
                    <span className="ml-2 text-xs font-normal text-gray-400">in progress</span>
                  </span>
                }
                value={<span className="text-gray-400">{money(current.moveOutNow)}</span>}
              >
                <RowCardStat label="Net realized YTD" className="text-gray-500">
                  {money(current.netRealizedYTD)}
                </RowCardStat>
                <RowCardStat label="Target (30%)" className="text-gray-500">
                  {money(current.reserveTarget)}
                </RowCardStat>
                <RowCardStat label="Already reserved" className="text-gray-500">
                  {money(current.alreadyReserved)}
                </RowCardStat>
                <p className="mt-1 text-xs text-gray-400">due {current.endDate}</p>
              </RowCard>
            </>
          }
          footer={
            <>
              {heldIn.length > 0 && (
                <p className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100">
                  Reserve held in:{' '}
                  {heldIn
                    .map(([accountId, amount]) =>
                      `${accountId ? accounts.find((a) => a.id === accountId)?.name ?? 'unknown' : 'unassigned'} ${money(amount)}`)
                    .join(' · ')}
                </p>
              )}
              <p className="px-4 py-3 text-xs text-gray-400 border-t border-gray-100">
                "Mark moved" writes the TaxSkim to the Cash Ledger — the money leaves the score's account
                column and joins the reserved column. There is no off switch.
              </p>
              {pileEstTax > 0 && (
                <p className="px-4 pb-3 text-xs text-gray-400">
                  Separately: parked-pile sales carry est. tax of {money(pileEstTax)}{' '}
                  — the skim never covers the pile; set that aside yourself.
                </p>
              )}
            </>
          }
        >
          <table className="w-full text-sm compact-table">
            <thead className="bg-gray-50 sticky top-0">
              <tr className={theadCls}>
                <th className="px-4 py-3">Quarter</th>
                <th className="px-4 py-3 text-right">Net realized YTD</th>
                <th className="px-4 py-3 text-right">Target (30%)</th>
                <th className="px-4 py-3 text-right">Already reserved</th>
                <th className="px-4 py-3 text-right">Move out now</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[...ended].reverse().map((c) => {
                const label = formatQuarterLabel(c);
                const due = c.moveOutNow > 0;
                return (
                  <tr key={label} className={cn('hover:bg-gray-50', due && 'bg-yellow-50')}>
                    <td className="px-4 py-3 font-medium whitespace-nowrap">
                      {label}
                      <span className="ml-2 text-xs font-normal text-gray-400">ended {c.endDate}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(c.netRealizedYTD)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(c.reserveTarget)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(c.alreadyReserved)}</td>
                    <td className={cn('px-4 py-3 text-right tabular-nums font-bold', due ? 'text-yellow-700' : 'text-gray-400')}>
                      {money(c.moveOutNow)}
                    </td>
                    <td className="px-4 py-3">
                      {due ? (
                        <button
                          onClick={() => setPendingSkim({ label, amount: c.moveOutNow })}
                          className={cn(primaryBtnCls, 'py-1 px-2.5 text-xs')}
                        >
                          {`Mark moved ${money(c.moveOutNow)}`}
                        </button>
                      ) : (
                        <span className="inline-block rounded-full bg-green-50 text-green-700 px-2 py-0.5 text-xs font-medium">
                          Settled
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-gray-50">
                <td className="px-4 py-3 font-medium whitespace-nowrap text-gray-500">
                  {formatQuarterLabel(current)}
                  <span className="ml-2 text-xs font-normal text-gray-400">in progress</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{money(current.netRealizedYTD)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{money(current.reserveTarget)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{money(current.alreadyReserved)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-400">{money(current.moveOutNow)}</td>
                <td className="px-4 py-3">
                  <span className="text-xs text-gray-400">due {current.endDate}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </TableCard>
      )}

      {pendingSkim && (
        <RecordSkimModal
          label={pendingSkim.label}
          amount={pendingSkim.amount}
          onClose={() => setPendingSkim(null)}
          onError={setRowError}
        />
      )}
      {carryOpen && <CarryforwardModal onClose={() => setCarryOpen(false)} />}
      {ratesOpen && (
        <RatesModal
          ltTaxRate={ltTaxRate}
          stTaxRate={stTaxRate}
          qualifiedRate={dividendTaxRates.qualified}
          ordinaryRate={dividendTaxRates.ordinary}
          onSave={(rates) =>
            updateSettings({
              lt_tax_rate: rates.lt,
              st_tax_rate: rates.st,
              qualified_dividend_tax_rate: rates.qualified,
              ordinary_dividend_tax_rate: rates.ordinary,
            })
          }
          onClose={() => setRatesOpen(false)}
        />
      )}
    </div>
  );
}

function CarryforwardModal({ onClose }: { onClose: () => void }) {
  const { carryforwards, setCarryforward } = useData();
  const [year, setYear] = useState(String(taxYearOf(todayISO())));
  const [amount, setAmount] = useState('');
  const [removing, setRemoving] = useState<{ taxYear: number; amount: number } | null>(null);
  const rows = [...carryforwards].sort((a, b) => b.taxYear - a.taxYear);

  // Saving keeps the modal open (the list is the point) and clears the amount.
  const { busy, formError, submit } = useModalForm(async () => {
    const y = Number(year);
    const amt = Number(amount);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
      throw new Error('Tax year looks wrong.');
    }
    if (Number.isNaN(amt) || amt <= 0) {
      throw new Error('Amount must be a positive dollar figure (the loss you carried in).');
    }
    await setCarryforward(y, amt);
    setAmount('');
  });

  return (
    <Modal isOpen onClose={onClose} title="Loss carryforwards">
      <div className="space-y-3">
        {rows.length > 0 ? (
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-100">
            {rows.map((c) => (
              <li key={c.taxYear} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>
                  Into <span className="font-medium">{c.taxYear}</span>:{' '}
                  <span className="tabular-nums">{money(c.amount)}</span>
                </span>
                <button
                  onClick={() => setRemoving(c)}
                  disabled={busy}
                  className="text-gray-400 hover:text-red-600"
                  title="Remove this carryforward"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-400">
            None recorded. After the 1099 arrives in January, enter any loss carried into the new
            tax year — it offsets gains before the 30% skim applies.
          </p>
        )}
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tax year">
              <input type="number" min="2000" max="2100" step="1" required value={year}
                onChange={(e) => setYear(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Loss carried in ($)">
              <input type="number" min="0" step="0.01" required value={amount}
                onChange={(e) => setAmount(e.target.value)} className={inputCls} placeholder="4000" />
            </Field>
          </div>
          <p className="text-xs text-gray-400">
            Enter the loss as a positive number. Saving a year that already has an entry replaces it.
          </p>
          <FormError message={formError} />
          <ModalFooter busy={busy} label="Save carryforward" />
        </form>
      </div>
      {removing && (
        <ConfirmModal
          title={`Remove the ${removing.taxYear} carryforward`}
          message={`Remove the ${money(removing.amount)} loss carried into ${removing.taxYear}? The 30% skim base for that year rises immediately — you'd need the 1099 to restore the figure.`}
          confirmLabel="Remove"
          onConfirm={() => setCarryforward(removing.taxYear, null)}
          onClose={() => setRemoving(null)}
        />
      )}
    </Modal>
  );
}

function RatesModal({
  ltTaxRate, stTaxRate, qualifiedRate, ordinaryRate, onSave, onClose,
}: {
  ltTaxRate: number;
  stTaxRate: number;
  qualifiedRate: number;
  ordinaryRate: number;
  onSave: (rates: { lt: number; st: number; qualified: number; ordinary: number }) => Promise<void>;
  onClose: () => void;
}) {
  const toPct = (v: number) => String(Math.round(v * 1000) / 10);
  const [lt, setLt] = useState(toPct(ltTaxRate));
  const [st, setSt] = useState(toPct(stTaxRate));
  const [qualified, setQualified] = useState(toPct(qualifiedRate));
  const [ordinary, setOrdinary] = useState(toPct(ordinaryRate));

  const { busy, formError, submit } = useModalForm(async () => {
    const parsed = [lt, st, qualified, ordinary].map(Number);
    if (parsed.some((v) => Number.isNaN(v) || v < 0 || v > 100)) {
      throw new Error('Rates are percentages between 0 and 100.');
    }
    await onSave({
      lt: parsed[0] / 100, st: parsed[1] / 100, qualified: parsed[2] / 100, ordinary: parsed[3] / 100,
    });
    onClose();
  });

  const field = (label: string, value: string, set: (v: string) => void) => (
    <Field label={label}>
      <input type="number" min="0" max="100" step="0.1" required value={value}
        onChange={(e) => set(e.target.value)} className={inputCls} />
    </Field>
  );

  return (
    <Modal isOpen onClose={onClose} title="Estimate rates">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {field('Long-term gains (%)', lt, setLt)}
          {field('Short-term gains (%)', st, setSt)}
          {field('Qualified dividends (%)', qualified, setQualified)}
          {field('Ordinary dividends (%)', ordinary, setOrdinary)}
        </div>
        <p className="text-xs text-gray-400">
          Used only for informational estimates on pile sales and parked dividends. The quarterly
          30% skim is fixed and never touched by these.
        </p>
        <FormError message={formError} />
        <ModalFooter busy={busy} label="Save rates" />
      </form>
    </Modal>
  );
}

interface RecordSkimProps {
  label: string;
  amount: number;
  onClose: () => void;
  onError: (msg: string) => void;
}

function RecordSkimModal({ label, amount, onClose, onError }: RecordSkimProps) {
  const { accounts, addCashEvent } = useData();
  const banks = accounts.filter((a) => a.kind === 'bank');
  const [destination, setDestination] = useState(banks[0]?.id ?? '');
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);

  // Deliberately NOT useModalForm: a write failure routes to the PAGE's
  // ErrorCard (onError) and closes — the skim row was the whole modal.
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    // The skim buckets by tax year of its date — an empty or wrong-year date
    // either bounces off Postgres or miscredits a different year's quarters.
    if (!date) return setFormError('Enter the date the money moved.');
    setBusy(true);
    try {
      await addCashEvent({
        date,
        type: 'TaxSkim',
        amount: roundCents(amount),
        sourceDestination: 'Tax reserve',
        destinationAccountId: destination || null,
        notes: `${label} skim — 30% of net realized YTD`,
      });
      onClose();
    } catch (e) {
      onError(errorMessage(e));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Move ${money(amount)} out of play`}>
      <form onSubmit={confirm} className="space-y-3">
        <Field label="Date moved">
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)}
            className={inputCls} />
          {date && taxYearOf(date) !== taxYearOf(todayISO()) && (
            <p className="mt-0.5 text-xs text-amber-700">
              {taxYearOf(date)} date — this skim counts toward that tax year's quarters, not this one's.
            </p>
          )}
        </Field>
        <AccountSelect accounts={accounts} value={destination} onChange={setDestination}
          label="Where is the reserve parked?" kinds={['bank']} />
        <p className="text-xs text-gray-400">
          {label} skim. The destination is bookkeeping only — the reserved amount counts toward
          Total Score either way.
        </p>
        <FormError message={formError} />
        <ModalFooter busy={busy} label="Mark moved" busyLabel="Recording…" />
      </form>
    </Modal>
  );
}
