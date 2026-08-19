import type { Account } from '../../lib/engine';
import { daysBetween } from '../../lib/engine';
import { cn, money, todayISO } from '../../lib/utils';
import { KIND_STYLES } from './shared';

export function AccountCard({ account: a, selected, onSelect, tracked, holdings, lastReconciled }: {
  account: Account;
  selected: boolean;
  onSelect: () => void;
  /** null = challenge account (its cash is the ledger's business). */
  tracked: number | null;
  holdings: { value: number } | null;
  lastReconciled: string | null;
}) {
  const recDays = lastReconciled ? daysBetween(lastReconciled, todayISO()) : null;
  return (
    <button
      onClick={onSelect}
      className={cn(
        'text-left bg-white rounded-lg shadow-lg p-4 density-aware-card transition-shadow hover:shadow-xl',
        selected && 'ring-2 ring-green-600',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-bold text-gray-900 truncate">{a.name}</span>
        <span className={cn('flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', KIND_STYLES[a.kind])}>
          {a.kind}
        </span>
        {a.retirementFlavor && (
          <span className="flex-shrink-0 rounded-full bg-purple-50 text-purple-700 px-1.5 py-0.5 text-[10px] font-medium">
            {a.retirementFlavor}
          </span>
        )}
      </div>
      {a.broker && <p className="text-xs text-gray-400 mt-0.5 truncate">{a.broker}</p>}
      {tracked === null ? (
        <p className="text-xs text-gray-400 mt-2">
          cash on the Cash Ledger · score math lives here
        </p>
      ) : (
        <>
          <p className="mt-2 text-lg sm:text-xl font-bold tabular-nums text-gray-900">
            {money(tracked)}
          </p>
          <p className="text-xs text-gray-400">
            tracked cash
            {holdings && <> · {money(holdings.value)} held</>}
            {' · '}
            {recDays == null ? 'never reconciled' : `reconciled ${recDays <= 0 ? 'today' : `${recDays}d ago`}`}
          </p>
        </>
      )}
    </button>
  );
}
