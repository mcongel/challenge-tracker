import { cn } from '../../lib/utils';

/** The house card shell — every panel in the app wears exactly this. */
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('bg-surface rounded-lg shadow-lg', className)}>{children}</div>;
}

/** The repeated thead row treatment (DESIGN.md's table spec), in one place. */
export const theadCls = 'text-left text-xs font-semibold uppercase tracking-wider text-text-muted';

/** Card around a table where ONLY the table scrolls sideways — toolbars and
 * footers stay put instead of dragging off-screen with the columns. When a
 * `cards` view is provided, phones get it instead of the sideways-scrolling
 * table (DESIGN.md: "tables collapse to cards on narrow viewports"). */
export function TableCard({
  className, toolbar, footer, cards, children,
}: {
  className?: string;
  /** Rendered above the scroller (filters, group-by chips, summaries). */
  toolbar?: React.ReactNode;
  /** Rendered below the scroller (totals lines, show-all buttons). */
  footer?: React.ReactNode;
  /** Phone rendering of the same rows (usually a list of <RowCard>s) —
   * shown below `sm` while the table takes over above it. */
  cards?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className={className}>
      {toolbar}
      {cards != null && <div className="sm:hidden divide-y divide-gray-100">{cards}</div>}
      <div className={cards != null ? 'hidden sm:block overflow-x-auto' : 'overflow-x-auto'}>
        {children}
      </div>
      {footer}
    </Card>
  );
}
