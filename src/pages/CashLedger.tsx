import { Wallet } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';

export function CashLedger() {
  return (
    <div>
      <PageHeader
        title="Cash Ledger"
        subtitle="Every dollar in and out — deposits, buys, sells, skims. Running balance beside each row."
      />
      <EmptyState
        icon={Wallet}
        title="No cash events yet"
        hint="Deposits, withdrawals, buys, sells, dividends, tax skims, milestone banks, and fees all land here. Adding a deposit will also record that day's shadow VOO purchase."
      />
    </div>
  );
}
