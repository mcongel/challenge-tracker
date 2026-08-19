import { cn } from '../../lib/utils';

/** The house card shell — every panel in the app wears exactly this. */
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('bg-white rounded-lg shadow-lg', className)}>{children}</div>;
}

/** The repeated thead row treatment (DESIGN.md's table spec), in one place. */
export const theadCls = 'text-left text-xs font-semibold uppercase tracking-wider text-gray-500';

/** Card around a table where ONLY the table scrolls sideways — toolbars and
 * footers stay put instead of dragging off-screen with the columns. */
export function TableCard({
  className, toolbar, footer, children,
}: {
  className?: string;
  /** Rendered above the scroller (filters, group-by chips, summaries). */
  toolbar?: React.ReactNode;
  /** Rendered below the scroller (totals lines, show-all buttons). */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className={className}>
      {toolbar}
      <div className="overflow-x-auto">{children}</div>
      {footer}
    </Card>
  );
}
