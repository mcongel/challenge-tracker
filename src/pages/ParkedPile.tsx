import { Archive } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';

export function ParkedPile() {
  return (
    <div>
      <PageHeader
        title="Parked Pile"
        subtitle="The foundation — context only, never in the score. Funding source (long-term trims) and skim destination, never refill fuel."
      />
      <EmptyState
        icon={Archive}
        title="Parked pile not seeded yet"
        hint="The one-time import from the workbook brings in MU, AMAT, AMKR, ASML, SOXX, NBIS, AMD, AVGO, GOOGL, GLW, MSTR, and the NVDA/TSLA transfer when it lands."
      />
    </div>
  );
}
