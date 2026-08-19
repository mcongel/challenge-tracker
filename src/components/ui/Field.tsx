import { cn, labelCls } from '../../lib/utils';

/** The label/control sandwich every form repeats. The control itself stays
 * the caller's — Field only owns the wrapper, label, and optional hint. */
export function Field({
  label, hint, className, children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(className)}>
      <label className={labelCls}>{label}</label>
      {children}
      {hint != null && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}
