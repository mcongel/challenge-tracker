import { AlertTriangle, Lock, Unlock } from 'lucide-react';
import type { UnlockSummary } from '../../lib/engine';
import { cn, formatCurrency, formatPercent, money, signedMoney } from '../../lib/utils';
import { unlockSentence } from './shared';

/** A flag, not a sentence — hover for the summary, expand the row for the
 * lot-by-lot schedule. "Unlocked" = held >1 year = Rule 5 trim fuel. */
/** Icon + the number that matters: dollars ready now, or the next unlock
 * date. The sentence stays in the tooltip for detail, but reading it is no
 * longer required — the Trim fuel card above the table has the full answer. */
export function UnlockCell({ summary: s, price }: { summary: UnlockSummary; price: number }) {
  if (s.totalShares <= 0) return <span className="text-xs text-gray-400">—</span>;
  const flag = (icon: React.ReactNode, cls: string, text?: React.ReactNode) => (
    <span className={cn('inline-flex items-center gap-1', cls)} title={unlockSentence(s)}>
      {icon}
      {text && <span className="text-xs tabular-nums">{text}</span>}
    </span>
  );
  if (s.unknownShares >= s.totalShares - 1e-9) {
    return flag(<AlertTriangle className="h-4 w-4" />, 'text-amber-600', 'needs dates');
  }
  if (s.unlockedShares > 0) {
    const ready = money(s.unlockedShares * price);
    const partial = s.unlockedShares < s.totalShares - 1e-9;
    // Fully unlocked = green; partial = amber open lock — some fuel, not all.
    return flag(
      <Unlock className="h-4 w-4" />,
      partial ? 'text-amber-600' : 'text-green-600',
      <>{ready} ready</>,
    );
  }
  return flag(
    <Lock className="h-4 w-4" />,
    'text-gray-400',
    s.nextUnlock ? `${s.nextUnlock.date.slice(5)}` : undefined,
  );
}

/** Unrealized gain: the dollar figure leads, the percent rides in a tinted
 * pill — same grammar as the day-change cell. */
export function UnrealCell({ gain, basis }: { gain: number; basis: number }) {
  const up = gain >= 0;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
      <span className={cn('font-medium', up ? 'text-green-600' : 'text-red-600')}>
        {signedMoney(gain)}
      </span>
      {basis > 0 && (
        <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium',
          up ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>
          {formatPercent(gain / basis)}
        </span>
      )}
    </span>
  );
}

/** The day's move, Google-Finance style: dollars then a tinted percent pill. */
export function DayChangeCell({
  move,
}: {
  move?: { change: number | null; changePct: number | null };
}) {
  if (!move || move.change === null) return <span className="text-xs text-gray-300">—</span>;
  const up = move.change >= 0;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
      <span className={up ? 'text-green-600' : 'text-red-600'}>
        {up ? '+' : '−'}{formatCurrency(Math.abs(move.change))}
      </span>
      {move.changePct !== null && (
        <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium',
          up ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>
          {move.changePct.toFixed(2)}%
        </span>
      )}
    </span>
  );
}
