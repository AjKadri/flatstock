// Shared visual pieces built from the logo's motif: a flat line with dots on it.
import type { CSSProperties, ReactNode } from "react";
import type { StockPrice } from "./lib/prices";
import { formatPrice } from "./lib/prices";

export type DotRow = { symbol: string; name?: string; weight: number; /* percent, 0-100 */ index: number };

// Mix as dots on a line: dot size = weight. Dots are buttons when onPick is given (vote screen).
export function DotLine({ rows, selected, onPick, disabled, size = "lg", showWeight = true }: {
  rows: DotRow[]; selected?: number | null; onPick?: (index: number) => void; disabled?: boolean; size?: "sm" | "lg"; showWeight?: boolean;
}) {
  const max = Math.max(...rows.map((row) => row.weight), 1);
  const cols = { "--n": rows.length } as CSSProperties;
  return (
    <div className={`dotline ${size}`} style={cols} role={onPick ? "radiogroup" : "img"} aria-label={rows.map((row) => `${row.symbol} ${row.weight.toFixed(0)}%`).join(", ")}>
      <div className="dl-dots">
        {rows.map((row) => {
          const scale = 0.34 + 0.66 * Math.sqrt(row.weight / max);
          const on = selected === row.index;
          const style = { "--s": on ? Math.min(1.25, scale * 1.35) : scale } as CSSProperties;
          const dot = <span className={`dl-dot ${on ? "on" : ""}`} style={style} />;
          return onPick
            ? <button key={row.symbol} role="radio" aria-checked={on} aria-label={`${row.symbol} ${row.weight.toFixed(1)}%`} className="dl-cell" disabled={disabled} onClick={() => onPick(row.index)}>{dot}</button>
            : <span key={row.symbol} className="dl-cell">{dot}</span>;
        })}
      </div>
      <div className="dl-rail" />
      <div className="dl-labels">
        {rows.map((row) => (
          <span key={row.symbol} className={`dl-label ${selected === row.index ? "on" : ""}`}>
            <b>{row.symbol}</b>
            {showWeight && <small>{row.weight.toFixed(row.weight < 10 ? 1 : 0)}%</small>}
          </span>
        ))}
      </div>
    </div>
  );
}

// Tiny price chart from recent Chainlink rounds.
export function Spark({ values, up }: { values: number[]; up?: boolean }) {
  if (values.length < 2) return <svg className="spark" viewBox="0 0 80 24" aria-hidden="true"><line x1="2" y1="12" x2="78" y2="12" className="spark-flat" /></svg>;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const points = values.map((value, i) => `${(2 + (i / (values.length - 1)) * 76).toFixed(1)},${(21 - ((value - min) / span) * 18).toFixed(1)}`);
  const last = points[points.length - 1].split(",");
  return (
    <svg className={`spark ${up === false ? "down" : "up"}`} viewBox="0 0 80 24" aria-hidden="true">
      <polyline points={points.join(" ")} />
      <circle cx={last[0]} cy={last[1]} r="2.6" />
    </svg>
  );
}

export function PriceTag({ price }: { price?: StockPrice }) {
  if (!price || price.price === null) return <span className="price mono muted">n/a</span>;
  const up = (price.changePct ?? 0) >= 0;
  return (
    <span className="price">
      <Spark values={price.history} up={up} />
      <span className="mono">${formatPrice(price.price)}</span>
      {price.changePct !== null && <small className={`mono ${up ? "up" : "down"}`}>{up ? "+" : ""}{price.changePct.toFixed(2)}%</small>}
    </span>
  );
}

// Loading state: a dot moving along the line.
export function Loader({ label = "Loading" }: { label?: string }) {
  return <div className="loader" role="status" aria-label={label}><span className="loader-rail" /><span className="loader-dot" /></div>;
}

// Divider: the line with a dot at its start.
export function Rule() {
  return <div className="rule" aria-hidden="true"><i /></div>;
}

// Round progress: the line from open to close with a dot at "now".
export function ProgressLine({ opensAt, closesAt, now, label }: { opensAt: number; closesAt: number; now: number; label?: ReactNode }) {
  const total = Math.max(closesAt - opensAt, 1);
  const done = Math.min(Math.max((now - opensAt) / total, 0), 1);
  return (
    <div className="progress">
      <div className="progress-track"><span className="progress-fill" style={{ width: `${done * 100}%` }} /><span className="progress-dot" style={{ left: `${done * 100}%` }} /></div>
      {label && <div className="progress-label mono">{label}</div>}
    </div>
  );
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return <div className="empty"><div className="empty-line"><span className="rail" /><i /></div><p>{children}</p></div>;
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#2BD67B" /><path d="M12 38h40" stroke="#07110C" strokeWidth="7" strokeLinecap="round" /><circle cx="44" cy="22" r="7" fill="#07110C" /></svg>
  );
}
