import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle } from 'lucide-react';
import { useData } from '../contexts/DataContext';
import { ConfirmModal } from './ui/ConfirmModal';
import { cn } from '../lib/utils';

/** First-run guidance. Renders only while setup steps remain; disappears for
 * good once the account is really running. */
export function GettingStarted() {
  const { exampleData, parked, cashEvents, lots, clearExampleData, loading } = useData();
  const [confirmClear, setConfirmClear] = useState(false);

  if (loading) return null;

  const missingDates = parked.filter((p) => !p.buyDate).length;
  const exampleIds = new Set(exampleData.cashEvents.map((e) => e.id));
  const exampleLotIds = new Set(exampleData.lots.map((l) => l.id));
  const hasRealDeposit = cashEvents.some((e) => e.type === 'Deposit' && !exampleIds.has(e.id));
  const hasRealPosition = lots.some((l) => !exampleLotIds.has(l.id));

  const steps: { label: React.ReactNode; done: boolean }[] = [
    {
      done: exampleData.total === 0,
      label:
        exampleData.total === 0 ? (
          'Clear the workbook example data'
        ) : (
          <span>
            Clear the workbook example data ({exampleData.total} rows — the numbers on screen
            aren't yours yet).{' '}
            <button
              onClick={() => setConfirmClear(true)}
              className="font-medium text-green-700 hover:underline"
            >
              Clear it now
            </button>
          </span>
        ),
    },
    {
      done: missingDates === 0,
      label: (
        <span>
          Add buy dates to the <Link to="/parked" className="font-medium text-green-700 hover:underline">parked pile</Link>
          {missingDates > 0 && ` (${missingDates} missing)`} — they drive the funding-unlock countdowns.
        </span>
      ),
    },
    {
      done: hasRealDeposit,
      label: (
        <span>
          Record your first real deposit on the{' '}
          <Link to="/ledger" className="font-medium text-green-700 hover:underline">Cash Ledger</Link>{' '}
          — it starts the benchmark and the daily history.
        </span>
      ),
    },
    {
      done: hasRealPosition,
      label: (
        <span>
          Open your first{' '}
          <Link to="/positions" className="font-medium text-green-700 hover:underline">position</Link>{' '}
          — one name, exit target written down. The scoreboard takes it from there.
        </span>
      ),
    },
  ];

  if (steps.every((s) => s.done)) return null;

  return (
    <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6">
      <p className="text-[11px] font-bold uppercase tracking-wider text-green-600 mb-0.5">
        Getting started
      </p>
      <h2 className="text-lg font-bold text-gray-900 mb-3">
        {steps.filter((s) => s.done).length} of {steps.length} done
      </h2>
      <ul className="space-y-2.5">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2.5 items-start text-sm">
            {step.done ? (
              <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
            ) : (
              <Circle className="h-5 w-5 text-gray-300 flex-shrink-0" />
            )}
            <span className={cn('leading-relaxed', step.done ? 'text-gray-400 line-through' : 'text-gray-600')}>
              {step.label}
            </span>
          </li>
        ))}
      </ul>

      {confirmClear && (
        <ConfirmModal
          title="Clear example data"
          message={`Delete the ${exampleData.total} workbook example rows (the NBIS position, its cash events, the MU trade, and the shadow VOO twin)? Your parked pile and accounts stay — they're real. The scoreboard resets to zero, ready for your first deposit.`}
          confirmLabel="Clear example data"
          onConfirm={clearExampleData}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
