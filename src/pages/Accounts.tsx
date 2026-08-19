import { useMemo, useState } from 'react';
import { Plus, Wallet } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ErrorCard } from '../components/ui/ErrorCard';
import { SkeletonTable } from '../components/ui/SkeletonTable';
import { AccountCard } from '../components/accounts/AccountCard';
import { AccountDetail } from '../components/accounts/AccountDetail';
import { AccountFormModal } from '../components/accounts/AccountFormModal';
import type { AccountUsage } from '../components/accounts/shared';
import { useData } from '../contexts/DataContext';
import type { Account, AccountKind } from '../lib/engine';
import { parkedMarketValue } from '../lib/engine';
import { cn, primaryBtnCls } from '../lib/utils';

/** Display order mirrors the app's walls: score money first, then context. */
const KIND_SECTIONS: { kind: AccountKind; label: string; blurb: string }[] = [
  { kind: 'challenge', label: 'Challenge', blurb: 'the trading account — its cash lives on the Cash Ledger' },
  { kind: 'bank', label: 'Bank', blurb: 'cash parking — deposits, interest, the tax reserve' },
  { kind: 'outside', label: 'Outside brokerage', blurb: 'taxable accounts holding the parked pile' },
  { kind: 'retirement', label: 'Retirement', blurb: 'behind its own wall — never in pile or score math' },
];

export function Accounts() {
  const {
    accounts, parked, parkedSales, outsideSales, cashEvents, parkedCashEvents,
    accountCash, deleteAccount, loading, error,
  } = useData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);

  // Last reconcile per account, one pass — the rows written by the reconcile
  // flow all carry a 'Reconciled…' note (including zero-diff "matched" ones).
  const lastReconciledByAccount = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of parkedCashEvents) {
      if (!e.notes?.startsWith('Reconciled')) continue;
      const prev = m.get(e.accountId);
      if (!prev || e.date > prev) m.set(e.accountId, e.date);
    }
    return m;
  }, [parkedCashEvents]);

  const usageById = useMemo(() => {
    const m = new Map<string, AccountUsage>();
    const get = (id: string): AccountUsage => {
      let u = m.get(id);
      if (!u) { u = { holdings: 0, pileSales: 0, ledgerRows: 0, outsideSaleRows: 0, cashMovements: 0 }; m.set(id, u); }
      return u;
    };
    for (const p of parked) get(p.accountId).holdings += 1;
    for (const s of parkedSales) get(s.accountId).pileSales += 1;
    for (const s of outsideSales) get(s.accountId).outsideSaleRows += 1;
    for (const e of cashEvents) {
      if (e.accountId) get(e.accountId).ledgerRows += 1;
      if (e.destinationAccountId) get(e.destinationAccountId).ledgerRows += 1;
    }
    for (const e of parkedCashEvents) get(e.accountId).cashMovements += 1;
    return m;
  }, [parked, parkedSales, outsideSales, cashEvents, parkedCashEvents]);

  const EMPTY_USAGE: AccountUsage = { holdings: 0, pileSales: 0, ledgerRows: 0, outsideSaleRows: 0, cashMovements: 0 };
  const usageOf = (id: string) => usageById.get(id) ?? EMPTY_USAGE;

  const holdingsValue = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of parked) {
      m.set(p.accountId, (m.get(p.accountId) ?? 0) + parkedMarketValue(p));
    }
    return m;
  }, [parked]);

  const selected = accounts.find((a) => a.id === selectedId) ?? null;

  if (loading) return <div><PageHeader title="Accounts" /><SkeletonTable /></div>;

  return (
    <div>
      <PageHeader
        title="Accounts"
        subtitle="Where money lives — labels and context only, never score math. Tracked cash is what the app routed here, not a claim about the real balance."
        actions={
          <button onClick={() => setAdding(true)} className={cn(primaryBtnCls, 'flex items-center gap-1.5')}>
            <Plus className="h-4 w-4" /> Add account
          </button>
        }
      />

      {error && <ErrorCard message={error} />}

      {accounts.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No accounts yet"
          hint="Add your bank, outside brokerage, and retirement accounts — every holding and cash movement hangs off one."
        />
      ) : (
        <div className="space-y-5">
          {KIND_SECTIONS.map(({ kind, label, blurb }) => {
            const group = accounts
              .filter((a) => a.kind === kind)
              .sort((a, b) => a.name.localeCompare(b.name));
            if (group.length === 0) return null;
            return (
              <div key={kind}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  {label} <span className="normal-case font-normal tracking-normal">— {blurb}</span>
                </p>
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {group.map((a) => (
                    <AccountCard
                      key={a.id}
                      account={a}
                      selected={a.id === selectedId}
                      onSelect={() => setSelectedId(a.id === selectedId ? null : a.id)}
                      tracked={a.kind === 'challenge' ? null : accountCash(a.id).balance}
                      holdings={usageOf(a.id).holdings > 0 ? { value: holdingsValue.get(a.id) ?? 0 } : null}
                      lastReconciled={lastReconciledByAccount.get(a.id) ?? null}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {selected ? (
            <AccountDetail
              account={selected}
              usage={usageOf(selected.id)}
              onEdit={() => setEditing(selected)}
              onDelete={() => setDeleting(selected)}
            />
          ) : (
            <p className="text-xs text-gray-400 text-center">
              Select an account to see its tracked cash, reconcile, or edit it.
            </p>
          )}
        </div>
      )}

      {adding && <AccountFormModal onClose={() => setAdding(false)} />}
      {editing && (
        <AccountFormModal
          account={editing}
          usage={usageOf(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmModal
          title={`Delete ${deleting.name}`}
          message={
            `Delete the account "${deleting.name}"? Nothing references it` +
            (usageOf(deleting.id).cashMovements > 0
              ? `, but its ${usageOf(deleting.id).cashMovements} manual cash movement${usageOf(deleting.id).cashMovements === 1 ? '' : 's'} (reconciles included) go with it.`
              : ', so nothing else changes.')
          }
          onConfirm={async () => {
            await deleteAccount(deleting.id);
            if (selectedId === deleting.id) setSelectedId(null);
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

