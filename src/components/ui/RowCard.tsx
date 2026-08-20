import { cn } from '../../lib/utils';

/** One table row rendered as a phone card (DESIGN.md: "tables collapse to
 * cards on narrow viewports"). Lives inside TableCard's `cards` slot, which
 * shows below `sm` while the real table takes over above it.
 *
 * Shape: a header line (title left, the row's headline value right), then
 * any number of <RowCardStat> label/value lines, then optional actions. */
export function RowCard({
  title, value, onClick, className, children, actions,
}: {
  /** Left side of the header line — ticker, date, name, pills. */
  title: React.ReactNode;
  /** Right side of the header line — the one number this row is about. */
  value?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  children?: React.ReactNode;
  /** Row-level buttons (edit/delete) — rendered as a right-aligned strip. */
  actions?: React.ReactNode;
}) {
  // active: uses the token, not a gray — raw gray-50 isn't in the dark
  // shim's allowlist and tap-flashed near-white on phones.
  return (
    <div
      className={cn('px-4 py-3', onClick && 'cursor-pointer active:bg-surface-muted', className)}
      onClick={onClick}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 text-sm font-medium text-text-primary">{title}</div>
        {value != null && (
          <div className="text-sm font-semibold tabular-nums text-text-primary whitespace-nowrap">
            {value}
          </div>
        )}
      </div>
      {children}
      {actions && <div className="mt-2 flex justify-end gap-2">{actions}</div>}
    </div>
  );
}

/** A label/value line inside a RowCard. */
export function RowCardStat({
  label, children, className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="mt-1 flex items-baseline justify-between gap-3 text-xs">
      <span className="text-text-muted">{label}</span>
      <span className={cn('tabular-nums text-text-secondary text-right', className)}>{children}</span>
    </div>
  );
}
