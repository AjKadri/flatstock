import { formatUnits } from "viem";

export const STOCK_TOKEN_DECIMALS = 18; // the Portfolio also reads Stock Token balances with 18 decimals
export type SellPercent = 25 | 50 | 75 | 100;

/**
 * The text for the sell input after a 25% / 50% / 75% / Max button, from the wallet's on-chain balance.
 * Everything is bigint maths: a percentage rounds DOWN to the smallest unit, Max is exactly the balance,
 * and formatUnits prints the exact value (no float, no rounding up). Returns "" when the result would be zero
 * (no balance, or a dust balance too small for the chosen percentage).
 */
export function sellAmountFromPercent(balance: bigint, percent: SellPercent, decimals = STOCK_TOKEN_DECIMALS): string {
  if (balance <= 0n) return "";
  const amount = percent === 100 ? balance : (balance * BigInt(percent)) / 100n;
  return amount > 0n ? formatUnits(amount, decimals) : "";
}
