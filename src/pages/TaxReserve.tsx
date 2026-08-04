import { Landmark } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';

export function TaxReserve() {
  return (
    <div>
      <PageHeader
        title="Tax Reserve"
        subtitle="Every quarter: 30% of net realized gains YTD moves out of play. Non-negotiable — it's what makes a blown account a shrug instead of a debt."
      />
      <EmptyState
        icon={Landmark}
        title="No quarters to settle yet"
        hint="The checklist auto-computes from the Trade Log after each calendar quarter ends, and nags until the move is recorded."
      />
    </div>
  );
}
