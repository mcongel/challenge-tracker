import { formatCurrency } from '../lib/utils';

/**
 * The scoreboard. Total Score is the one big honest number (the SpokenFor
 * stat-block pattern), flanked by its three components. Real data arrives
 * with the Supabase phase — until then every figure renders as a true zero
 * with the "no data yet" hint, never a fake placeholder.
 */
export function Dashboard() {
  const accountValue = 0;
  const banked = 0;
  const reserved = 0;
  const totalScore = accountValue + banked + reserved;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Hero: Total Score flanked by its three components */}
      <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Total Score
        </p>
        <p className="mt-1 font-display text-5xl sm:text-6xl font-bold tabular-nums text-gray-900">
          {formatCurrency(totalScore)}
        </p>
        <p className="mt-2 text-xs text-gray-400">
          account + banked floors + tax reserved · every banked dollar is already won
        </p>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-500">Account value</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900">
              {formatCurrency(accountValue)}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">positions + cash · everything rides</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-500">Banked floors</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-green-600">
              {formatCurrency(banked)}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">locked forever · the floor only rises</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-500">Tax reserved</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-sky-600">
              {formatCurrency(reserved)}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">30% of realized gains, out of play</p>
          </div>
        </div>
      </div>

      {/* Aspiration bar */}
      <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium text-gray-700">Progress toward $1,000,000</p>
          <p className="text-xs text-gray-400">aspiration — direction, not a verdict</p>
        </div>
        <div className="mt-3 h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-indigo-600 rounded-full transition-all"
            style={{ width: `${Math.min(100, (totalScore / 1_000_000) * 100)}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-gray-400 tabular-nums">
          {((totalScore / 1_000_000) * 100).toFixed(1)}% · final height is the prize
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6 text-center">
        <p className="text-sm text-gray-500">No data yet.</p>
        <p className="mt-1 text-xs text-gray-400">
          The scoreboard fills in once the database is connected and the workbook seed is imported.
        </p>
      </div>
    </div>
  );
}
