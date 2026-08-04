import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { startOfToday, addMonths } from 'date-fns';
import { CreditCard, ChevronRight, PiggyBank } from 'lucide-react';
import { RecurringTransaction, Transaction } from '../../types';
import { cardOwedFor, deriveCardPayments, getOrdinalSuffix } from '../../lib/forecastEngine';
import { calculateSpokenFor } from '../../lib/spokenFor';
import { formatCurrency, cn } from '../../lib/utils';
import { useAccounts } from '../../contexts/AccountsContext';
import { useAccount } from '../../contexts/AccountContext';
import { useAccountsActivity } from '../../hooks/useAccountsActivity';
import { useCreditCardActivityWithStatus } from '../../hooks/useCreditCardActivity';

function groupByAccount<T extends { account_id: string }>(rows: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const row of rows) (out[row.account_id] ??= []).push(row);
  return out;
}

/**
 * App-wide overview of every account: each checking account's safe-to-spend and
 * each card's owed balance, at a glance. Clicking one opens that account's
 * Forecast detail. This is the whole-app half of the dashboard (the combined
 * spending breakdown is the other half).
 */
export function AccountsOverview() {
  const { accounts } = useAccounts();
  const { setSelectedAccount } = useAccount();
  const navigate = useNavigate();

  const accountIds = useMemo(() => accounts.map((a) => a.id), [accounts]);
  const { recurring, oneTime, ready: activityReady } = useAccountsActivity(accountIds);
  const { cards: cardActivities, ready: cardsReady } = useCreditCardActivityWithStatus();
  // Same rule as the hero: never paint a money figure from half-loaded
  // fetches. Savings cards only read current_balance, so they never wait.
  const settled = activityReady && cardsReady;

  const summaries = useMemo(() => {
    const recByAccount = groupByAccount(recurring as (RecurringTransaction & { account_id: string })[]);
    const oneByAccount = groupByAccount(oneTime as (Transaction & { account_id: string })[]);
    const today = startOfToday();
    // Match the per-account Forecast detail page, which defaults to 3 months.
    const months = 3;
    const end = addMonths(today, months);

    return accounts.map((account) => {
      const acctRecurring = recByAccount[account.id] ?? [];
      const acctOneTime = oneByAccount[account.id] ?? [];

      // Savings is not spending-side: "safe to spend" doesn't apply, and its
      // card opens the Goals page, not a forecast.
      if (account.account_type === 'savings') {
        return { account, isSavings: true as const };
      }

      if (account.account_type === 'credit_card') {
        // Card activity (not the page-scoped rows) carries the recurring
        // templates and recent cleared overrides the owed math needs to count
        // bare past instances without double counting hand-cleared ones.
        const activity = cardActivities.find((c) => c.account.id === account.id);
        return {
          account,
          owed: cardOwedFor({
            account,
            recurring: activity?.recurring ?? [],
            oneTime: activity?.oneTime ?? acctOneTime,
          }),
        };
      }

      const derived = deriveCardPayments(account, cardActivities, today, end);
      const analysis = calculateSpokenFor(account, acctRecurring, acctOneTime, months, derived);
      return { account, analysis };
    });
  }, [accounts, recurring, oneTime, cardActivities]);

  const open = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;
    // A savings account's home is the Goals page — never a forecast detour.
    if (account.account_type === 'savings') {
      navigate(`/savings?account=${account.id}`);
      return;
    }
    setSelectedAccount(account);
    navigate('/timeline');
  };

  const statusColor = (color: string) =>
    color === 'red' ? 'text-red-600' : color === 'yellow' ? 'text-yellow-600' : 'text-green-600';

  // Grouped by type, in check-frequency order, matching the header
  // switcher's grouping so the mental model is the same everywhere.
  // Empty groups render nothing (no orphan headers).
  const groups = [
    {
      label: 'Spending',
      items: summaries.filter(
        (s) => s.account.account_type !== 'credit_card' && s.account.account_type !== 'savings',
      ),
    },
    {
      label: 'Credit cards',
      items: summaries.filter((s) => s.account.account_type === 'credit_card'),
    },
    {
      label: 'Savings',
      items: summaries.filter((s) => s.account.account_type === 'savings'),
    },
  ].filter((g) => g.items.length > 0);
  // A single-group account list needs no group header at all.
  const showGroupLabels = groups.length > 1;

  const renderCard = (s: (typeof summaries)[number]) => {
          const isCard = s.account.account_type === 'credit_card';
          const isSavings = 'isSavings' in s && s.isSavings;
          return (
            <button
              key={s.account.id}
              type="button"
              onClick={() => open(s.account.id)}
              className="text-left rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {isCard && <CreditCard className="h-4 w-4 text-indigo-600 flex-shrink-0" />}
                  {isSavings && <PiggyBank className="h-4 w-4 text-green-600 flex-shrink-0" />}
                  <span className="text-sm font-medium text-gray-700 truncate">{s.account.name}</span>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
              </div>

              {isSavings ? (
                <>
                  <div className="text-2xl font-bold text-green-600">
                    {formatCurrency(s.account.current_balance)}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">saved · goals live here</div>
                </>
              ) : !settled ? (
                <>
                  <div className="h-8 w-28 rounded bg-gray-100 animate-pulse" />
                  <div className="mt-1.5 h-3 w-40 rounded bg-gray-100 animate-pulse" />
                </>
              ) : isCard ? (
                <>
                  <div className="text-2xl font-bold text-red-600">{formatCurrency(s.owed!)}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    owed{s.account.statement_due_day != null ? ` · due the ${getOrdinalSuffix(s.account.statement_due_day)}` : ''}
                  </div>
                </>
              ) : (
                <>
                  <div className={cn('text-2xl font-bold', statusColor(s.analysis!.status.color))}>
                    {formatCurrency(s.analysis!.notSpokenFor)}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    safe to spend · {formatCurrency(s.account.current_balance)} balance
                  </div>
                </>
              )}
            </button>
          );
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6">
      <h2 className="text-lg sm:text-xl font-bold text-gray-600 mb-4">Your accounts</h2>
      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.label}>
            {showGroupLabels && (
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                {group.label}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {group.items.map(renderCard)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
