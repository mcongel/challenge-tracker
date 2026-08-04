import { ScrollText } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';

export function TradeLog() {
  return (
    <div>
      <PageHeader
        title="Trade Log"
        subtitle="Every close, with ST/LT status and wash-sale flags. The YTD realized number feeds the tax skim."
      />
      <EmptyState
        icon={ScrollText}
        title="No closed trades yet"
        hint="Trades appear here when positions are closed. Net realized gains this tax year drive the quarterly 30% reserve."
      />
    </div>
  );
}
