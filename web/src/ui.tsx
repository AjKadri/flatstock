// Shared pieces. The mix is one rounded allocation bar plus a holdings-style table (Option A in design/refs/mix-options.png).
import type { ReactNode } from "react";
import type { StockPrice } from "./lib/prices";
import { formatPrice } from "./lib/prices";

// Ink -> greens, largest weight first. The same stock keeps its colour in the bar and in the table key.
export const MIX_COLORS = ["#07110c", "#1e4f37", "#2f6b4b", "#6fa687", "#9cc5af", "#2bd67b", "#5ee09b", "#a5ebc9"];

export type MixRow = {
  symbol: string;
  name?: string;
  index: number;
  weight: number; // percent, 0-100
  price?: StockPrice;
  sub?: string; // replaces the full name under the ticker (for example "12.3 shares")
  extra?: ReactNode; // optional last column value
};

// Rank by weight (largest first, ties by on-chain index) and give each stock its colour.
export function mixColorMap(rows: { index: number; weight: number }[]): Map<number, string> {
  const ranked = [...rows].sort((a, b) => b.weight - a.weight || a.index - b.index);
  return new Map(ranked.map((row, rank) => [row.index, MIX_COLORS[Math.min(rank, MIX_COLORS.length - 1)]]));
}

// One flat rounded bar split by weight, 3px gaps, no labels on the bar.
export function AllocationBar({ rows }: { rows: { symbol: string; index: number; weight: number }[] }) {
  const colors = mixColorMap(rows);
  const ranked = [...rows].filter((row) => row.weight > 0).sort((a, b) => b.weight - a.weight || a.index - b.index);
  return (
    <div className="abar" role="img" aria-label={`Allocation: ${ranked.map((row) => `${row.symbol} ${row.weight.toFixed(1)} percent`).join(", ")}`}>
      {ranked.map((row) => <span key={row.symbol} style={{ flexGrow: row.weight, background: colors.get(row.index) }} />)}
    </div>
  );
}

// Tiny price chart from the last 24h of Chainlink rounds.
export function Spark({ values, up }: { values: number[]; up?: boolean }) {
  if (values.length < 2) return <svg className="spark" viewBox="0 0 80 24" aria-hidden="true"><line x1="2" y1="12" x2="78" y2="12" className="spark-flat" /></svg>;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const points = values.map((value, i) => `${(2 + (i / (values.length - 1)) * 76).toFixed(1)},${(21 - ((value - min) / span) * 18).toFixed(1)}`);
  return (
    <svg className={`spark ${up === false ? "down" : "up"}`} viewBox="0 0 80 24" aria-hidden="true">
      <polyline points={points.join(" ")} />
    </svg>
  );
}

export function ChangeCell({ price }: { price?: StockPrice }) {
  if (!price || price.changePct === null) return <span className="mono muted">n/a</span>;
  const up = price.changePct >= 0;
  return <span className={`mono ${up ? "up" : "down"}`}>{up ? "+" : "−"}{Math.abs(price.changePct).toFixed(2)}%{price.stale && <small className="since">since last close</small>}</span>;
}

// Holdings-style table. market=false (past rounds) shows only stock and weight, with no live prices.
export function MixTable({ rows, market = true, selected, onPick, disabled, lead, extraHead, keepOrder, isOff, label = "Stocks in the mix" }: {
  rows: MixRow[];
  market?: boolean;
  selected?: number | null;
  onPick?: (index: number) => void;
  disabled?: boolean;
  lead?: (row: MixRow) => ReactNode; // replaces the colour key (for example a checkbox in Adjust mode)
  extraHead?: string;
  keepOrder?: boolean; // keep the given row order instead of sorting by weight
  isOff?: (row: MixRow) => boolean; // dim a row (for example an unticked stock in Adjust mode)
  label?: string;
}) {
  const colors = mixColorMap(rows);
  const sorted = keepOrder ? rows : [...rows].sort((a, b) => b.weight - a.weight || a.index - b.index);
  return (
    <table className={`mix ${onPick ? "selectable" : ""}`} aria-label={label}>
      <thead>
        <tr>
          <th className="key" aria-hidden="true" />
          <th>Stock</th>
          {market && <th className="c-spark">24h</th>}
          {market && <th className="r">Price</th>}
          {market && <th className="r">24h change</th>}
          <th className="r">Weight</th>
          {extraHead && <th className="r">{extraHead}</th>}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => {
          const on = selected === row.index;
          const p = row.price;
          const up = (p?.changePct ?? 0) >= 0;
          return (
            <tr
              key={row.symbol}
              className={`${on ? "sel" : ""} ${isOff?.(row) ? "off" : ""}`}
              role={onPick ? "radio" : undefined}
              aria-checked={onPick ? on : undefined}
              tabIndex={onPick && !disabled ? 0 : undefined}
              onClick={onPick && !disabled ? () => onPick(row.index) : undefined}
              onKeyDown={onPick && !disabled ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPick(row.index); } } : undefined}
            >
              <td className="key">{lead ? lead(row) : <i style={{ background: colors.get(row.index) }} />}</td>
              <td className="stock"><b className="mono">{row.symbol}</b><small>{row.sub ?? row.name ?? ""}</small></td>
              {market && <td className="c-spark">{p && p.price !== null ? <Spark values={p.history} up={up} /> : null}</td>}
              {market && <td className="r mono">{p && p.price !== null ? `$${formatPrice(p.price)}` : "n/a"}</td>}
              {market && <td className="r"><ChangeCell price={p} /></td>}
              <td className="r mono w">{row.weight.toFixed(2)}%</td>
              {extraHead && <td className="r mono">{row.extra}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Loading state: a grey bar and grey rows in the shape of the real layout.
export function Loader({ label = "Loading", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="skel" role="status" aria-label={label} aria-busy="true">
      <div className="skel-bar" />
      {Array.from({ length: rows }, (_, i) => <div className="skel-row" key={i} />)}
    </div>
  );
}

// Divider: a plain line.
export function Rule() {
  return <hr className="rule" />;
}

// Round progress: a plain filled line from open to close.
export function ProgressLine({ opensAt, closesAt, now, label }: { opensAt: number; closesAt: number; now: number; label?: ReactNode }) {
  const total = Math.max(closesAt - opensAt, 1);
  const done = Math.min(Math.max((now - opensAt) / total, 0), 1);
  return (
    <div className="progress">
      <div className="progress-track"><span className="progress-fill" style={{ width: `${done * 100}%` }} /></div>
      {label && <div className="progress-label mono">{label}</div>}
    </div>
  );
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#2BD67B" /><path d="M12 38h40" stroke="#07110C" strokeWidth="7" strokeLinecap="round" /><circle cx="44" cy="22" r="7" fill="#07110C" /></svg>
  );
}
