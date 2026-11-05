// Shared visual pieces built from the logo's motif: a flat line with dots on it.
// Dots only ever stand for stocks (size = weight) or progress. No decorative dots.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { StockPrice } from "./lib/prices";
import { formatPrice } from "./lib/prices";

export type DotRow = {
  symbol: string;
  name?: string;
  weight: number; // percent, 0-100
  index: number;
  price?: StockPrice;
};

const MIN_DOT = 44; // px: fits the ticker and is a comfortable tap target
const MIN_CELL = 84; // px: room for the "50% · $350.99" caption

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(node.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", update); return () => window.removeEventListener("resize", update); }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

// Tiny price chart from recent Chainlink rounds.
export function Spark({ values, up, big }: { values: number[]; up?: boolean; big?: boolean }) {
  const cls = `spark ${big ? "big" : ""}`;
  if (values.length < 2) return <svg className={cls} viewBox="0 0 80 24" aria-hidden="true"><line x1="2" y1="12" x2="78" y2="12" className="spark-flat" /></svg>;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const points = values.map((value, i) => `${(2 + (i / (values.length - 1)) * 76).toFixed(1)},${(21 - ((value - min) / span) * 18).toFixed(1)}`);
  const last = points[points.length - 1].split(",");
  return (
    <svg className={`${cls} ${up === false ? "down" : "up"}`} viewBox="0 0 80 24" aria-hidden="true">
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

function Popover({ row, edge }: { row: DotRow; edge: "left" | "right" | "mid" }) {
  const price = row.price;
  const up = (price?.changePct ?? 0) >= 0;
  return (
    <div className={`dl-pop ${edge}`} role="tooltip">
      <b>{row.name || row.symbol}</b>
      <span className="mono">{row.symbol} · {row.weight.toFixed(row.weight < 10 ? 2 : 1)}%</span>
      {price && price.price !== null ? (
        <>
          <Spark values={price.history} up={up} big />
          <span className="mono">${formatPrice(price.price)} {price.changePct !== null && <em className={up ? "up" : "down"}>{up ? "+" : ""}{price.changePct.toFixed(2)}%</em>}</span>
          <small>Chainlink price, last {price.history.length} updates</small>
        </>
      ) : <small>Price not available</small>}
    </div>
  );
}

// The mix as dots on a line. Dot area is proportional to weight (diameter = sqrt), never below 44px.
// Rows wrap on narrow screens so nothing overlaps or is cut off (8 stocks at 6.25% on a 375px phone = 2 rows of 4).
export function DotLine({ rows, selected, onPick, disabled, size = "lg", showPrice = true }: {
  rows: DotRow[]; selected?: number | null; onPick?: (index: number) => void; disabled?: boolean; size?: "sm" | "lg"; showPrice?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  useEffect(() => {
    if (pinned === null) return;
    const close = (event: Event) => { if (!(event.target as HTMLElement).closest?.(".dotline")) setPinned(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [pinned]);

  const cols = Math.max(1, Math.min(rows.length, width ? Math.floor(width / (showPrice ? MIN_CELL : 64)) : rows.length));
  const cell = width ? width / cols : 120;
  const maxDiameter = Math.max(MIN_DOT, Math.min(size === "lg" ? 96 : 58, cell - 12));
  const wmax = Math.max(...rows.map((row) => row.weight), 1);
  // The largest-weight stock gets the logo green, but only when it is strictly the largest (no green on ties).
  const topWeight = Math.max(...rows.map((row) => row.weight));
  const lead = rows.filter((row) => row.weight === topWeight).length === 1 ? rows.findIndex((row) => row.weight === topWeight) : -1;
  const chunks: DotRow[][] = [];
  for (let i = 0; i < rows.length; i += cols) chunks.push(rows.slice(i, i + cols));
  const open = pinned ?? hover;

  return (
    <div className={`dotline ${size}`} ref={ref} role={onPick ? "radiogroup" : "group"} aria-label="Mix: dot size shows each stock's weight">
      {chunks.map((chunk, chunkIndex) => (
        <div className="dl-row" key={chunkIndex} style={{ "--cols": cols } as CSSProperties}>
          <div className="dl-dots">
            {chunk.map((row, position) => {
              const on = selected === row.index;
              const isLead = !onPick && rows.indexOf(row) === lead;
              const diameter = Math.max(MIN_DOT, maxDiameter * Math.sqrt(row.weight / wmax)) * (on ? 1.18 : 1);
              const edge = position === 0 && cols > 1 ? "left" : position === chunk.length - 1 && cols > 1 ? "right" : "mid";
              return (
                <div className="dl-cell" key={row.symbol} onMouseEnter={() => setHover(row.index)} onMouseLeave={() => setHover(null)}>
                  <button
                    type="button"
                    className={`dl-dot ${on ? "on" : ""} ${isLead ? "lead" : ""}`}
                    style={{ width: diameter, height: diameter }}
                    role={onPick ? "radio" : undefined}
                    aria-checked={onPick ? on : undefined}
                    aria-label={`${row.name || row.symbol}, ${row.weight.toFixed(1)} percent${row.price?.price ? `, $${formatPrice(row.price.price)}` : ""}`}
                    disabled={Boolean(onPick) && disabled}
                    onFocus={() => setHover(row.index)}
                    onBlur={() => setHover(null)}
                    onClick={() => { if (onPick) onPick(row.index); else setPinned(pinned === row.index ? null : row.index); }}
                  >
                    <span>{row.symbol}</span>
                  </button>
                  {open === row.index && <Popover row={row} edge={edge} />}
                </div>
              );
            })}
          </div>
          <div className="dl-rail" />
          <div className="dl-labels">
            {chunk.map((row) => (
              <span key={row.symbol} className={`dl-label ${selected === row.index ? "on" : ""}`}>
                <b>{row.weight.toFixed(row.weight < 10 ? 1 : 0)}%</b>
                {showPrice && row.price?.price ? <><span className="sep">{" · "}</span><span className="px">${formatPrice(row.price.price)}</span></> : null}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Loading state: a dot moving along the line (progress).
export function Loader({ label = "Loading" }: { label?: string }) {
  return <div className="loader" role="status" aria-label={label}><span className="loader-rail" /><span className="loader-dot" /></div>;
}

// Divider: a plain line.
export function Rule() {
  return <hr className="rule" />;
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
  return <p className="empty">{children}</p>;
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#2BD67B" /><path d="M12 38h40" stroke="#07110C" strokeWidth="7" strokeLinecap="round" /><circle cx="44" cy="22" r="7" fill="#07110C" /></svg>
  );
}
