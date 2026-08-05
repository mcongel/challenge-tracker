import type { Account, AccountKind } from '../../lib/engine';
import { inputCls, labelCls } from '../../lib/utils';

interface AccountSelectProps {
  accounts: Account[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** Restrict the options to these kinds; omit for all. */
  kinds?: AccountKind[];
  allowNone?: boolean;
}

export function AccountSelect({
  accounts, value, onChange, label, kinds, allowNone = true,
}: AccountSelectProps) {
  const options = kinds ? accounts.filter((a) => kinds.includes(a.kind)) : accounts;
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {allowNone && <option value="">—</option>}
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}
