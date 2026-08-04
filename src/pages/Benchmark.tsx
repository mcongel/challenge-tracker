import { Swords } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';

export function Benchmark() {
  return (
    <div>
      <PageHeader
        title="Benchmark"
        subtitle="The honest test: every deposit buys shadow VOO the same day. Beat the shadow over rolling 12 months and the edge is real."
      />
      <EmptyState
        icon={Swords}
        title="No shadow purchases yet"
        hint="Each deposit into the challenge account creates one automatically. The shadow ignores VOO dividends (which flatters you) and pre-tax gains (which flatters VOO) — read the lead accordingly."
      />
    </div>
  );
}
