import { contributionStatus } from '../../lib/engine';
import { formatCurrencyWhole } from '../../lib/utils';

interface Props {
  netContributed: number;
  cap: number | null;
}

/** Rule 11 status: quiet until 80% of the cap, persistent once reached. */
export function ContributionCapBadge({ netContributed, cap }: Props) {
  if (cap === null) return null;
  const status = contributionStatus(netContributed, cap);
  if (status.state === 'OK') return null;

  if (status.state === 'NEARING') {
    return (
      <span className="mt-1 inline-block rounded-full bg-amber-50 text-amber-800 px-2 py-0.5 text-xs font-medium">
        {formatCurrencyWhole(status.remaining)} of contribution room left
      </span>
    );
  }

  return (
    <span className="mt-1 inline-block rounded-full bg-red-50 text-red-700 px-2 py-0.5 text-xs font-bold">
      Contribution cap reached — growth by trading only
    </span>
  );
}
