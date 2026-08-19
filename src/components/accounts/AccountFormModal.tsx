import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { FormError, ModalFooter, useModalForm } from '../ui/useModalForm';
import { useData } from '../../contexts/DataContext';
import type { Account, AccountKind } from '../../lib/engine';
import { cn, inputCls } from '../../lib/utils';
import { usageBlockers } from './shared';
import type { AccountUsage } from './shared';

const FLAVOR_DATALIST = (
  <datalist id="retirement-flavors">
    <option value="Roth IRA" /><option value="Traditional IRA" />
    <option value="401k" /><option value="Roth 401k" />
    <option value="403b" /><option value="457b" /><option value="457b Roth" />
    <option value="ORP" /><option value="HSA" />
  </datalist>
);

/** One form for both create and edit. Kind is offered on create and on edits
 * of accounts nothing structural references yet — the wall between pile and
 * retirement means a kind change re-routes future holdings, so a referenced
 * account's kind stays put. */
export function AccountFormModal({ account, usage, onClose }: {
  account?: Account;
  usage?: AccountUsage;
  onClose: () => void;
}) {
  const { accounts, addAccount, updateAccount } = useData();
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'bank');
  const [broker, setBroker] = useState(account?.broker ?? '');
  const [flavor, setFlavor] = useState(account?.retirementFlavor ?? '');

  const blockers = usage ? usageBlockers(usage) : [];
  const kindLocked = account !== undefined && (account.kind === 'challenge' || blockers.length > 0);

  const { busy, formError, submit } = useModalForm(async () => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Name required.');
    if (accounts.some((a) => a.id !== account?.id && a.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`An account named "${trimmed}" already exists.`);
    }
    try {
      if (account) {
        await updateAccount(account.id, {
          name: trimmed,
          broker: broker.trim() || null,
          ...(kindLocked ? {} : { kind }),
          retirementFlavor: (kindLocked ? account.kind : kind) === 'retirement' ? flavor.trim() || null : null,
        });
      } else {
        await addAccount(trimmed, kind, broker.trim() || undefined, flavor.trim() || undefined);
      }
    } catch (err) {
      // 23505 = unique violation — races past the client-side check.
      const isDuplicate = typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === '23505';
      if (isDuplicate) throw new Error(`An account named "${trimmed}" already exists.`);
      throw err;
    }
    onClose();
  });

  const effectiveKind = kindLocked && account ? account.kind : kind;

  return (
    <Modal isOpen onClose={onClose} title={account ? `Edit ${account.name}` : 'Add account'}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Name" className="col-span-2">
            <input required autoFocus value={name} onChange={(e) => setName(e.target.value)}
              className={inputCls} placeholder="Ally Savings" />
          </Field>
          <Field label="Kind">
            {kindLocked && account ? (
              <input disabled value={account.kind} className={cn(inputCls, 'bg-gray-50 text-gray-500')} />
            ) : (
              <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)} className={inputCls}>
                <option value="bank">bank</option>
                <option value="outside">outside</option>
                <option value="retirement">retirement</option>
              </select>
            )}
          </Field>
        </div>
        <Field label="Broker / institution (optional)">
          <input value={broker} onChange={(e) => setBroker(e.target.value)} className={inputCls} />
        </Field>
        {effectiveKind === 'retirement' && (
          <Field
            label="Flavor (Roth / traditional / 401k…)"
            hint="Retirement holdings get their own page — never in the pile's total, cap, or taxes."
          >
            <input value={flavor} onChange={(e) => setFlavor(e.target.value)} className={inputCls}
              placeholder="Roth IRA" list="retirement-flavors" />
            {FLAVOR_DATALIST}
          </Field>
        )}
        <p className="text-xs text-gray-400">
          {account
            ? kindLocked && account.kind !== 'challenge'
              ? `Kind is locked while the account is referenced (${blockers.join(' · ')}) — it steers pile vs retirement logic.`
              : 'History, cash, and holdings reference the account by id — relabeling moves nothing.'
            : 'Accounts are labels for where money lives — they never change the score.'}
        </p>
        <FormError message={formError} />
        <ModalFooter busy={busy} label={account ? 'Save' : 'Add account'} onCancel={onClose} />
      </form>
    </Modal>
  );
}
