// Dev-only visual test pages (not part of the production bundle): http://localhost:5173/?demo=dots
import { DotLine, type DotRow } from "./ui";
import { assets } from "./config";
import type { StockPrice } from "./lib/prices";

const fakeHistory = (base: number, seed: number) => Array.from({ length: 20 }, (_, i) => base * (1 + Math.sin((i + seed) / 2.6) * 0.012 + i * 0.0004 * (seed % 2 ? 1 : -1)));
const prices = (symbol: string, index: number): StockPrice => {
  const base = [352.84, 190.87, 549.55, 266.56, 288.68, 616.39, 351.58, 759.17][index] ?? 100;
  const history = fakeHistory(base, index);
  return { symbol, price: history[19], updatedAt: 0, history, changePct: (history[19] / history[0] - 1) * 100 };
};

export default function DevDemo() {
  const equal: DotRow[] = assets.map((asset, index) => ({ symbol: asset.symbol, name: asset.name, index, weight: 6.25, price: prices(asset.symbol, index) }));
  const spread = [16.25, 21.25, 6.25, 6.25, 6.25, 6.25, 26.25, 11.25];
  const mixed: DotRow[] = assets.map((asset, index) => ({ symbol: asset.symbol, name: asset.name, index, weight: spread[index], price: prices(asset.symbol, index) }));
  return (
    <main className="page" style={{ paddingTop: 24 }}>
      <h2>8 stocks at 6.25% (equal)</h2>
      <DotLine rows={equal} />
      <h2>8 stocks, spread votes</h2>
      <DotLine rows={mixed} />
      <h2>Vote mode, TSLA selected</h2>
      <DotLine rows={mixed} selected={6} onPick={() => undefined} />
      <h2>Small (past round)</h2>
      <DotLine rows={mixed} size="sm" showPrice={false} />
    </main>
  );
}
