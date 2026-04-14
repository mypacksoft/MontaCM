interface Props {
  label: string;
  used: number;
  total: number;
  unit?: string;
  showValues?: boolean;
}

export default function ResourceBar({ label, used, total, unit = '', showValues = true }: Props) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const color =
    pct >= 90 ? 'bg-red-500' :
    pct >= 75 ? 'bg-amber-400' :
    'bg-emerald-500';

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        {showValues && (
          <span className="text-xs text-slate-500">
            {used.toFixed(1)}{unit} / {total.toFixed(1)}{unit}
          </span>
        )}
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
