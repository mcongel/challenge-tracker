import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { useData } from '../contexts/DataContext';
import { lotsByPositionId } from '../lib/engine';
import { AlertRow, BELL_ONLY_KINDS } from '../components/AlertsBell';
import { useActiveAlerts } from '../lib/useActiveAlerts';
import { useScoreSummary } from '../lib/useScoreSummary';
import { useCoverage } from '../lib/useCoverage';
import {
  isArchivedPosition, isNeverTrimFuel, lead, netContributed,
  netRealizedYTD, nextMilestone, pileTotal, roundCents, taxYearOf,
  unlockSummary,
} from '../lib/engine';
import { ErrorCard } from '../components/ui/ErrorCard';
import { ContributionCapBadge } from '../components/ui/ContributionCapBadge';
import { GettingStarted } from '../components/GettingStarted';
import { Card } from '../components/ui/Card';
import { cn, compactUsd, formatCurrency, formatCurrencyWhole, formatPercent, money, todayISO } from '../lib/utils';
import { useChartColors } from '../lib/useIsDark';

/** Chart palette — validated (dataviz six checks) for both surfaces.
 * You = brand green (green-600 both modes); Shadow VOO = indigo 600/500.
 * Green+amber failed protan CVD (ΔE 6.2); green+indigo passes cleanly. */
const SERIES = {
  you: { light: '#16a34a', dark: '#16a34a' },
  shadow: { light: '#4f46e5', dark: '#6366f1' },
  floor: { light: '#16a34a', dark: '#22c55e' },
};


export function Dashboard() {
  const {
    // pileParked: the pile tile and the unlock line are pile rules —
    // retirement and the bitcoin bucket never move them.
    cashEvents, trades, milestones, pileParked: parked, btcParked,
    retirementParked, parkedLots,
    snapshots, contributionCap, concentrationCap,
    loading, error, quotesSettled,
  } = useData();
  const { isDark, gridColor, axisColor } = useChartColors();
  const today = todayISO();

  // Until the first quote pass lands, position prices are cost/stale
  // fallbacks — the score would paint one number and jump to another a beat
  // later. Hold the price-derived figures at a placeholder instead.
  const settling = loading || !quotesSettled;

  const { account, floor, reserved, score, shadow, vooToday } = useScoreSummary();
  const coverage = useCoverage();
  const next = nextMilestone(account, milestones);
  const ytd = netRealizedYTD(trades, taxYearOf(today));
  // Act-now banners only — chronic/contextual alerts (over-cap, entry
  // triggers) live in the header bell instead of shouting here forever.
  const { alerts: allAlerts, dismiss } = useActiveAlerts();
  const alerts = allAlerts.filter((a) => !BELL_ONLY_KINDS.has(a.kind));

  // Soonest unlock across the pile — the trim calendar at a glance. Rule 5's
  // never-trim holds are excluded: their unlocks are not trim fuel.
  const nextUnlock = useMemo(() => {
    const lotsByPosition = lotsByPositionId(parkedLots);
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
  // Combined pots value — only days where all three were tracked, so the
  // line never fakes growth that was really just tracking starting. Each
  // pot's own page has its own line; here the sum is the story.
  const potsData = snapshots
    .filter((s) => s.retirementValue != null && s.retirementValue > 0)
    .map((s) => ({
      date: s.date.slice(5),
      Value: roundCents(s.parkedPileValue + (s.btcValue ?? 0) + (s.retirementValue ?? 0)),
    }));
  // Its own series — a percent doesn't belong in the dollar charts' rows.
  const concentrationData = snapshots.map((s) => ({
    date: s.date.slice(5),
    'Semis %': Math.round(s.semiAiPct * 1000) / 10,
  }));
  const youColor = isDark ? SERIES.you.dark : SERIES.you.light;
  const shadowColor = isDark ? SERIES.shadow.dark : SERIES.shadow.light;
  const floorColor = isDark ? SERIES.floor.dark : SERIES.floor.light;

  return (
    <div className="space-y-4 sm:space-y-6">
      {error && <ErrorCard message={error} />}

      <GettingStarted />

      {/* Active alerts — price-driven (targets, cap), so they wait for the
          first quote pass rather than flashing on cost-fallback prices. */}
      {!settling && alerts.map((a) => <AlertRow key={a.id} alert={a} dismiss={dismiss} />)}

      {/* Hero: the one big honest number */}
      <Card className="p-6 sm:p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Total Score</p>
        <p className="mt-1 text-4xl sm:text-6xl font-bold tabular-nums text-gray-900">
          {settling ? '…' : formatCurrencyWhole(score)}
        </p>
        <p className="mt-2 text-xs text-gray-400">
          account + banked floors + tax reserved · every banked dollar is already won
        </p>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          <Link to="/positions" className="rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors">
            <p className="text-xs font-medium text-gray-500">Account value</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900">
              {settling ? '…' : money(account)}
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
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-sky-600">{money(reserved)}</p>
            <p className="text-xs text-gray-400 mt-0.5">30% of realized gains, out of play</p>
          </Link>
        </div>
      </Card>

      {/* Next milestone + aspiration */}
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-gray-700">
            Next milestone:{' '}
            <span className="tabular-nums font-bold">{settling ? '…' : formatCurrency(next)}</span>
            <span className="ml-2 text-gray-400 tabular-nums">
              {settling ? '' : `${money(Math.max(0, next - account))} to go`}
            </span>
          </p>
          <p className="text-xs text-gray-400">$1M is the aspiration — direction, not a verdict</p>
        </div>
        <div className="mt-3 h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-green-600 rounded-full transition-all"
            style={{ width: settling ? 0 : `${Math.min(100, (score / 1_000_000) * 100)}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-gray-400 tabular-nums">
          {settling ? '…' : `${((score / 1_000_000) * 100).toFixed(1)}%`} · final height is the prize
        </p>
      </Card>

      {/* Supporting stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4 density-aware-card">
          <p className="text-xs font-medium text-gray-500">Net contributed</p>
          <p className="mt-0.5 text-lg sm:text-xl font-bold tabular-nums text-gray-900">
            {formatCurrency(netContributed(cashEvents))}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            true stake so far{contributionCap !== null && ` · ${formatCurrencyWhole(contributionCap)} cap`}
          </p>
          <ContributionCapBadge netContributed={netContributed(cashEvents)} cap={contributionCap} />
        </Card>
        <Link to="/benchmark" className="bg-white rounded-lg shadow-lg p-4 density-aware-card block hover:bg-gray-50 transition-colors">
          <p className="text-xs font-medium text-gray-500">Lead vs VOO shadow</p>
          {settling ? (
            <p className="mt-0.5 text-xl font-bold text-gray-400">…</p>
          ) : shadow === null ? (
            <p className="mt-0.5 text-xl font-bold text-gray-400">set VOO price</p>
          ) : (
            <p className={cn('mt-0.5 text-lg sm:text-xl font-bold tabular-nums',
              lead(score, shadow) >= 0 ? 'text-green-600' : 'text-red-600')}>
              {money(lead(score, shadow))}
            </p>
          )}
          <p className="text-xs text-gray-400 mt-0.5">the honest test</p>
        </Link>
        <Link to="/trades" className="bg-white rounded-lg shadow-lg p-4 density-aware-card block hover:bg-gray-50 transition-colors">
          <p className="text-xs font-medium text-gray-500">Net realized {taxYearOf(today)}</p>
          <p className={cn('mt-0.5 text-lg sm:text-xl font-bold tabular-nums', ytd >= 0 ? 'text-green-600' : 'text-red-600')}>
            {money(ytd)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">drives the tax skim</p>
        </Link>
      </div>

      {/* The other book: three pots that share a card but never the score. */}
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <p className="text-sm font-medium text-gray-700">Beyond the challenge</p>
          <p className="text-lg sm:text-xl font-bold tabular-nums text-gray-900">
            {money(pileTotal(parked) + pileTotal(btcParked) + pileTotal(retirementParked))}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Link to="/parked" className="rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors">
            <p className="text-xs font-medium text-gray-500">Parked pile</p>
            <p className="mt-0.5 text-lg sm:text-xl font-bold tabular-nums text-gray-700">
              {money(pileTotal(parked))}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {nextUnlock
                ? `next unlock: ${String(Number(nextUnlock.next.shares.toFixed(4)))} sh ${nextUnlock.ticker} on ${nextUnlock.next.date}`
                : 'the foundation — funding source'}
            </p>
          </Link>
          <Link to="/bitcoin" className="rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors">
            <p className="text-xs font-medium text-gray-500">Bitcoin</p>
            <p className="mt-0.5 text-lg sm:text-xl font-bold tabular-nums text-gray-700">
              {money(pileTotal(btcParked))}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">the conviction bucket — held, not traded</p>
          </Link>
          <Link to="/retirement" className="rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors">
            <p className="text-xs font-medium text-gray-500">Retirement</p>
            <p className="mt-0.5 text-lg sm:text-xl font-bold tabular-nums text-gray-700">
              {money(pileTotal(retirementParked))}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">behind its own wall — tax-sheltered</p>
          </Link>
          <Link to="/coverage" className="rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors">
            <p className="text-xs font-medium text-gray-500">Living expenses</p>
            {coverage.snapshot.totalCount > 0 ? (
              <>
                <p className={cn('mt-0.5 text-lg sm:text-xl font-bold tabular-nums',
                  coverage.snapshot.coveragePct >= 1 ? 'text-green-600' : 'text-gray-700')}>
                  {formatPercent(coverage.snapshot.coveragePct, 0)}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {coverage.snapshot.coveredCount} of {coverage.snapshot.totalCount} bills · {money(coverage.spendableMonthly)}/mth spendable
                </p>
              </>
            ) : (
              <>
                <p className="mt-0.5 text-lg sm:text-xl font-bold tabular-nums text-gray-400">—</p>
                <p className="text-xs text-green-700 mt-0.5">set up income coverage →</p>
              </>
            )}
          </Link>
        </div>
        {potsData.length === 1 && (
          <p className="mt-3 text-xs text-gray-400 text-center">
            The combined line draws after two daily snapshots with all three pots tracked —
            day one is on the books.
          </p>
        )}
        {potsData.length >= 2 && (
          <div className="h-40 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={potsData} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={gridColor} vertical={false} />
                <XAxis dataKey="date" stroke={axisColor} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11 }} minTickGap={32} />
                <YAxis stroke={axisColor} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11 }} tickFormatter={compactUsd} width={52}
                  domain={['auto', 'auto']} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Area type="monotone" dataKey="Value" strokeWidth={2}
                  stroke={isDark ? SERIES.floor.dark : SERIES.floor.light}
                  fill={isDark ? SERIES.floor.dark : SERIES.floor.light} fillOpacity={0.12} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-2 text-xs text-gray-400">
          context only — none of this is in the score or the benchmark
          {potsData.length >= 2 && ' · value, not return: contributions and buys move this line too'}
        </p>
      </Card>

      {/* The race: Total Score vs shadow VOO over time */}
      <Card className="p-4 sm:p-6">
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
      </Card>

      {/* Concentration trend — is the semiconductor share of the pile drifting toward the cap? */}
      {concentrationData.length >= 2 && (
        <Card className="p-4 sm:p-6">
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
        </Card>
      )}

      {/* Banked floors staircase */}
      <Card className="p-4 sm:p-6">
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
      </Card>

    </div>
  );
}
