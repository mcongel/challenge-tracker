import { Link } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { Card } from '../ui/Card';
import type { Account } from '../../lib/engine';
import { cn, secondaryBtnCls } from '../../lib/utils';
import { KIND_STYLES, usageBlockers } from './shared';
import type { AccountUsage } from './shared';
import { AccountCashPanel } from './AccountCashPanel';

export function AccountDetail({ account, usage, onEdit, onDelete }: {
  account: Account;
  usage: AccountUsage;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const blockers = usageBlockers(usage);
  const deletable = account.kind !== 'challenge' && blockers.length === 0;
  const deleteTitle = account.kind === 'challenge'
    ? 'The challenge account is the scoreboard — it stays.'
    : blockers.length > 0
      ? `Still referenced: ${blockers.join(' · ')}. Move or delete those first.`
      : 'Delete this empty account';

  return (
    <Card className="density-aware-card">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <h2 className="text-lg font-bold text-gray-900 truncate">{account.name}</h2>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', KIND_STYLES[account.kind])}>
          {account.kind}
        </span>
        {account.retirementFlavor && (
          <span className="rounded-full bg-purple-50 text-purple-700 px-1.5 py-0.5 text-[10px] font-medium">
            {account.retirementFlavor}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={onEdit} className={cn(secondaryBtnCls, 'flex items-center gap-1.5 py-1.5')}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
          <button
            onClick={onDelete}
            disabled={!deletable}
            title={deleteTitle}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-white transition-colors flex items-center gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </div>

      {account.kind === 'challenge' ? (
        <p className="px-4 pb-4 pt-2 text-sm text-gray-500">
          This is the trading account — its cash, deposits, and skims all live on the{' '}
          <Link to="/ledger" className="font-medium text-green-700 hover:underline">Cash Ledger</Link>.
        </p>
      ) : (
        <AccountCashPanel account={account} />
      )}
    </Card>
  );
}
