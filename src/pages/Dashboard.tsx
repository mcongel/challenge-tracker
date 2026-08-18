import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { useData } from '../contexts/DataContext';
import { activeAlerts, priceMapFor } from '../lib/alerts';
import {
  accountTotal, cumulativeFloor, isArchivedPosition, isNeverTrimFuel, lead, netContributed,
  netRealizedYTD, nextMilestone, pileTotal, reservedTotal, roundCents, shadowValue, taxYearOf,
  totalScore, unlockSummary,
} from '../lib/engine';
import { ErrorCard } from './CashLedger';
import { ContributionCapBadge } from '../components/ui/ContributionCapBadge';
import { GettingStarted } from '../components/GettingStarted';
import { cn, compactUsd, formatCurrency, formatCurrencyWhole, todayISO } from '../lib/utils';
import { useIsDark } from '../lib/useIsDark';

/** Chart palette — validated (dataviz six checks) for both surfaces.
 * You = brand green (green-600 both modes); Shadow VOO = indigo 600/500.
 * Green+amber failed protan CVD (ΔE 6.2); green+indigo passes cleanly. */
const SERIES = {
  you: { light: '#16a34a', dark: '#16a34a' },
  shadow: { light: '#4f46e5', dark: '#6366f1' },
  floor: { light: '#16a34a', dark: '#22c55e' },
};

const ALERT_STYLES: Record<string, string> = {
  MILESTONE: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  TARGET: 'bg-green-50 text-green-700 border-green-200',
  TAX: 'bg-yellow-50 text-yellow-800 border-amber-300 border',
  CAP: 'bg-red-50 text-red-700 border-red-200',
  ENTRY: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  CALENDAR: 'bg-amber-50 text-amber-800 border-amber-200',
};

export function Dashboard() {
  const {
    // pileParked: the pile tile, CAP alert, and unlock line are pile rules —
    // retirement money never moves them.
    lots, cashEvents, trades, milestones, benchmarkDeposits, pileParked: parked, parkedLots,
    snapshots, carryforwards, overrides, quotes, contributionCap, concentrationCap, watchlist,
    loading, error,
  } = useData();
  const isDark = useIsDark();
  const today = todayISO();

  const priceMap = priceMapFor(lots, overrides, quotes);
  const account = accountTotal(lots, priceMap, cashEvents);
  const floor = cumulativeFloor(milestones);
  const reserved = reservedTotal(cashEvents);
  const score = totalScore(lots, priceMap, cashEvents, milestones);
  const vooToday = overrides['VOO'] ?? quotes['VOO'];
  const shadow = vooToday ? shadowValue(benchmarkDeposits, vooToday) : null;
  const next = nextMilestone(account);
  const ytd = netRealizedYTD(trades, taxYearOf(today));
  const alerts = activeAlerts({
    lots, cashEvents, trades, milestones, parked, carryforwards, overrides, quotes,
    concentrationCap, watchlist, today,
  });

  // Soonest unlock across the pile — the trim calendar at a glance. Rule 5's
  // never-trim holds are excluded: their unlocks are not trim fuel.
  const nextUnlock = useMemo(() => {
    const lotsByPosition = new Map<string, typeof parkedLots>();
    for (const l of parkedLots) {
      const list = lotsByPosition.get(l.parkedPositionId);
      if (list) list.push(l);
      else lotsByPosition.set(l.parkedPositionId, [l]);
    }
    return parked
      .filter((p) => !isArchivedPosition(p) && !isNeverTrimFuel(p))
      .map((p) => ({
        ticker: p.ticker,
        next: unlockSummary(lotsByPosition.get(p.id) ?? [], today).nextUnlock,
      }))
      .filter((x): x is { ticker: string; next: NonNullable<typeof x.next> } => x.next != null)
      .sort((a, b) => a.next.date.localeCompare(b.next.date))[0] ?? null;
  }, [parked, parkedLots, today]);

  const chartData = snapshots.map((s) => ({
    date: s.date.slice(5),
    'Total Score': roundCents(s.totalScore),
    'Shadow VOO': roundCents(s.shadowVooValue),
    Floor: roundCents(s.bankedTotal),
  }));
  // Its own series — a percent doesn't belong in the dollar charts' rows.
  const concentrationData = snapshots.map((s) => ({
    date: s.date.slice(5),
    'Semis %': Math.round(s.semiAiPct * 1000) / 10,
  }));
  const youColor = isDark ? SERIES.you.dark : SERIES.you.light;
  const shadowColor = isDark ? SERIES.shadow.dark : SERIES.shadow.light;
  const floorColor = isDark ? SERIES.floor.dark : SERIES.floor.light;
  const gridColor = isDark ? '#334155' : '#e5e7eb';
  const axisColor = isDark ? '#94a3b8' : '#6b7280';

  return (
    <div className="space-y-4 sm:space-y-6">
      {error && <ErrorCard message={error} />}

      <GettingStarted />

      {/* Active alerts */}
      {alerts.map((a) => (
        <Link
          key={a.kind + a.message}
          to={a.to}
          className={cn('block rounded-lg px-4 py-3 text-sm font-bold border', ALERT_STYLES[a.kind],
            a.kind === 'MILESTONE' && 'animate-fade-in-up')}
        >
          {a.message} →
        </Link>
      ))}

      {/* Hero: the one big honest number */}
      <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Total Score</p>
        <p className="mt-1 text-5xl sm:text-6xl font-bold tabular-nums text-gray-900">
          {loading ? '…' : formatCurrencyWhole(score)}
        </p>
        <p className="mt-2 text-xs text-gray-400">
          account + banked floors + tax reserved · every banked dollar is already won
        </p>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          <Link to="/positions" className="rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors">
            <p className="text-xs font-medium text-gray-500">Account value</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900">
              {formatCurrency(roundCents(account))}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">positions + cash · everything rides</p>
          </Link>
          <Link to="/milestones" className="rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors">
            <p className="text-xs font-medium text-gray-500">Banked floors</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-green-600">{formatCurrency(floor)}</p>
            <p className="text-xs text-gray-400 mt-0.5">locked forever · the floor only rises</p>
          </Link>
          <Link to="/tax" className="rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors">
            <p className="text-xs font-medium text-gray-500">Tax reserved</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-sky-600">{formatCurrency(roundCents(reserved))}</p>
            <p className="text-xs text-gray-400 mt-0.5">30% of realized gains, out of play</p>
          </Link>
        </div>
      </div>

      {/* Next milestone + aspiration */}
      <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-gray-700">
            Next milestone: <span className="tabular-nums font-bold">{formatCurrency(next)}</span>
            <span className="ml-2 text-gray-400 tabular-nums">
              {formatCurrency(roundCents(Math.max(0, next - account)))} to go
            </span>
          </p>
          <p className="text-xs text-gray-400">$1M is the aspiration — direction, not a verdict</p>
        </div>
        <div className="mt-3 h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-green-600 rounded-full transition-all"
            style={{ width: `${Math.min(100, (score / 1_000_000) * 100)}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-gray-400 tabular-nums">
          {((score / 1_000_000) * 100).toFixed(1)}% · final height is the prize
        </p>
      </div>

      {/* Supporting stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg shadow-lg p-4 density-aware-card">
          <p className="text-xs font-medium text-gray-500">Net contributed</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums text-gray-900">
            {formatCurrency(netContributed(cashEvents))}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            true stake so far{contributionCap !== null && ` · ${formatCurrencyWhole(contributionCap)} cap`}
          </p>
          <ContributionCapBadge netContributed={netContributed(cashEvents)} cap={contributionCap} />
        </div>
        <Link to="/benchmark" className="bg-white rounded-lg shadow-lg p-4 density-aware-card block hover:bg-gray-50 transition-colors">
          <p className="text-xs font-medium text-gray-500">Lead vs VOO shadow</p>
          {shadow === null ? (
            <p className="mt-0.5 text-xl font-bold text-gray-400">set VOO price</p>
          ) : (
            <p className={cn('mt-0.5 text-xl font-bold tabular-nums',
              lead(score, shadow) >= 0 ? 'text-green-600' : 'text-red-600')}>
              {formatCurrency(roundCents(lead(score, shadow)))}
            </p>
          )}
          <p className="text-xs text-gray-400 mt-0.5">the honest test</p>
        </Link>
        <Link to="/trades" className="bg-white rounded-lg shadow-lg p-4 density-aware-card block hover:bg-gray-50 transition-colors">
          <p className="text-xs font-medium text-gray-500">Net realized {taxYearOf(today)}</p>
          <p className={cn('mt-0.5 text-xl font-bold tabular-nums', ytd >= 0 ? 'text-green-600' : 'text-red-600')}>
            {formatCurrency(roundCents(ytd))}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">drives the tax skim</p>
        </Link>
        <Link to="/parked" className="bg-white rounded-lg shadow-lg p-4 density-aware-card block hover:bg-gray-50 transition-colors">
          <p className="text-xs font-medium text-gray-500">Parked pile</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums text-gray-500">
            {formatCurrency(roundCents(pileTotal(parked)))}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {nextUnlock
              ? `next unlock: ${String(Number(nextUnlock.next.shares.toFixed(4)))} sh ${nextUnlock.ticker} on ${nextUnlock.next.date}`
              : 'context only — not in score'}
          </p>
        </Link>
      </div>

      {/* The race: Total Score vs shadow VOO over time */}
      <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6">
        <p className="text-sm font-medium text-gray-700 mb-1">The race</p>
        {chartData.length < 2 ? (
          <p className="text-xs text-gray-400 py-6 text-center">
            The chart starts after two daily snapshots.{' '}
            {!vooToday && 'Set a VOO price on the Benchmark screen to start recording history.'}
          </p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={gridColor} strokeDasharray="0" vertical={false} />
                <XAxis dataKey="date" stroke={axisColor} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11 }} minTickGap={32} />
                <YAxis stroke={axisColor} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11 }} tickFormatter={compactUsd} width={52} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Total Score" stroke={youColor} strokeWidth={2}
                  dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="Shadow VOO" stroke={shadowColor} strokeWidth={2}
                  dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Concentration trend — is the semiconductor share of the pile drifting toward the cap? */}
      {concentrationData.length >= 2 && (
        <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6">
          <p className="text-sm font-medium text-gray-700 mb-1">Pile concentration — semiconductor share</p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={concentrationData} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={gridColor} vertical={false} />
                <XAxis dataKey="date" stroke={axisColor} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11 }} minTickGap={32} />
                <YAxis stroke={axisColor} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} width={40} />
                <Tooltip formatter={(v) => `${v}%`} />
                <ReferenceLine y={concentrationCap * 100} stroke="#d97706" strokeDasharray="4 4"
                  label={{ value: `cap ${Math.round(concentrationCap * 100)}%`, position: 'insideTopRight', fontSize: 11, fill: '#d97706' }} />
                <Line type="monotone" dataKey="Semis %" stroke={shadowColor} strokeWidth={2}
                  dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Banked floors staircase */}
      <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6">
        <p className="text-sm font-medium text-gray-700 mb-1">Banked floors</p>
        {floor === 0 ? (
          <p className="text-xs text-gray-400 py-6 text-center">
            The staircase starts at $100k — 25% banked at every level, and it never goes back down.
          </p>
        ) : chartData.length < 2 ? (
          <p className="text-xs text-gray-400 py-6 text-center">
            {formatCurrency(floor)} locked. The staircase draws after two daily snapshots.
          </p>
        ) : (
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={gridColor} vertical={false} />
                <XAxis dataKey="date" stroke={axisColor} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11 }} minTickGap={32} />
                <YAxis stroke={axisColor} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11 }} tickFormatter={compactUsd} width={52} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Area type="stepAfter" dataKey="Floor" stroke={floorColor} strokeWidth={2}
                  fill={floorColor} fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
