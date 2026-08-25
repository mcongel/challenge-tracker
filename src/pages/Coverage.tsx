import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { SkeletonTable } from '../components/ui/SkeletonTable';
import { ErrorCard } from '../components/ui/ErrorCard';
import { CoveragePanel } from '../components/income/CoveragePanel';
import { MonthlyCoverageChart } from '../components/income/MonthlyCoverageChart';
import { PaymentsTracker } from '../components/income/PaymentsTracker';
import { CapitalAtWork } from '../components/income/CapitalAtWork';
import { useData } from '../contexts/DataContext';
import { useCoverage } from '../lib/useCoverage';
import { formatPercent, money } from '../lib/utils';

/** Living-expenses coverage — the pile as an income engine. Plan (coverage
 * snowball) → seasonal reality (monthly chart) → actuals (payments), all on
 * one screen so "how close am I, how much more do I need, and am I actually
 * living on the yield" reads top to bottom. */
export function Coverage() {
  const { expenses, loading, error } = useData();
  const cov = useCoverage();

  const planPct = cov.snapshot.coveragePct;
  const actualIncomeShare = cov.paymentsYtd.total > 0
    ? cov.paymentsYtd.fromIncome / cov.paymentsYtd.total
    : null;

  return (
    <div>
      <PageHeader
        title="Living Expenses"
        subtitle="How much of your bills the dividend income covers — cheapest first — and whether the actual withdrawals came from the yield or from principal."
      />
      {error && <ErrorCard message={error} />}

      {loading ? (
        <SkeletonTable />
      ) : !cov.hasAny ? (
        <EmptyState
          icon={Wallet}
          title="Nothing to cover yet"
          hint="Add a dividend holding on the Parked Pile, then add your bills here to see how much of them your income covers — and how much more you'd need to invest to cover the rest."
        />
      ) : (
        <>
          <CoveragePanel
            spendableMonthly={cov.spendableMonthly}
            reinvestingMonthly={cov.reinvestingMonthly}
            afterTaxYieldOnCost={cov.afterTaxYieldOnCost}
          />

          <CapitalAtWork capital={cov.capital} afterTaxYieldOnCost={cov.afterTaxYieldOnCost} />

          {/* Bridge the plan to the actuals so the two cards below aren't
              read in isolation. */}
          {cov.snapshot.totalCount > 0 && actualIncomeShare != null && (
            <p className="mb-4 -mt-2 px-1 text-xs text-gray-400">
              Projected to cover <b className="text-gray-500">{formatPercent(planPct, 0)}</b> of your bills;
              of what you actually drew this year, <b className="text-gray-500">{formatPercent(actualIncomeShare, 0)}</b>{' '}
              came from income{cov.paymentsYtd.fromPrincipal > 0 && <> and {money(cov.paymentsYtd.fromPrincipal)} from principal</>}.
            </p>
          )}

          <MonthlyCoverageChart
            incomeByMonth={cov.spendableByMonth}
            payersByMonth={cov.spendablePayersByMonth}
            expenses={expenses}
          />

          <PaymentsTracker />

          <p className="text-xs text-gray-400 px-1">
            Only holdings marked <b>Spend</b> on the{' '}
            <Link to="/income" className="text-green-700 hover:underline">Income page</Link>{' '}
            count here; the coverage headline is annualized, so a month can still fall short even
            above 100% — the chart shows which.
          </p>
        </>
      )}
    </div>
  );
}
