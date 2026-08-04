import { Flag } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { formatCurrency } from '../lib/utils';

const LEVELS = [100_000, 200_000, 400_000, 800_000, 1_000_000];

export function Milestones() {
  return (
    <div>
      <PageHeader
        title="Milestones"
        subtitle="Below $100k everything rides. At each level: bank 25% into VOO in the parked pile. Banked money never returns."
      />
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr className="text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
              <th className="px-4 py-3">Milestone</th>
              <th className="px-4 py-3 text-right">Skim (25%)</th>
              <th className="px-4 py-3 text-right">Banked</th>
              <th className="px-4 py-3 text-right">Cumulative floor</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {LEVELS.map((level) => (
              <tr key={level} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium tabular-nums">{formatCurrency(level)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-400">—</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-400">—</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-400">—</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                    <Flag className="h-3 w-3" /> not yet
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-3 text-xs text-gray-400 border-t border-gray-100">
          $1M is the aspiration marker. Past $800k the ladder keeps doubling — $1.6M, $3.2M — same
          25% rule.
        </p>
      </div>
    </div>
  );
}
