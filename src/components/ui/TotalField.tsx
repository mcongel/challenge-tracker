import { inputCls, labelCls } from '../../lib/utils';

/** The notional-mode "total dollars" input — one component so the label,
 * attributes, and explainer stay identical across every trade form. */
export function TotalField({
  value, onChange, label = 'Total ($)',
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        type="number"
        step="any"
        min="0"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
        title="Enter the broker's filled notional (net of fees) and the per-share price derives — no rounding drift."
      />
    </div>
  );
}
