import { TrendingUp } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';

export function Positions() {
  return (
    <div>
      <PageHeader
        title="Positions"
        subtitle="Open lots in the challenge account. Every entry needs an exit target and a bail point — no exceptions."
      />
      <EmptyState
        icon={TrendingUp}
        title="No open positions"
        hint="Each buy becomes its own lot. Closing a lot moves it to the Trade Log and writes the Sell to the Cash Ledger."
      />
    </div>
  );
}
