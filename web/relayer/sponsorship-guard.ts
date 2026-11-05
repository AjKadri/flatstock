// Low-balance guard for gas sponsorship.
// Pure logic: the caller supplies getBalance, so it runs the same against a
// mock, an anvil fork or the live chain. Fails closed when the balance is unknown.

export const SPONSORSHIP_PAUSED_MESSAGE = "Gas sponsorship paused, you can still buy and pay your own gas.";
// 0.0003 ETH
export const DEFAULT_MIN_RELAYER_BALANCE_WEI = 300_000_000_000_000n;

export type SponsorshipPauseReason = "low-balance" | "balance-unavailable";

export type SponsorshipStatus = {
  paused: boolean;
  reason: SponsorshipPauseReason | null;
  balanceWei: bigint | null;
  minBalanceWei: bigint;
};

export class SponsorshipPausedError extends Error {
  status: SponsorshipStatus;
  constructor(status: SponsorshipStatus) {
    super(SPONSORSHIP_PAUSED_MESSAGE);
    this.name = "SponsorshipPausedError";
    this.status = status;
  }
}

export type SponsorshipGuardOptions = {
  getBalance: () => Promise<bigint>;
  minBalanceWei?: bigint;
  // A balance read newer than this is reused.
  cacheMs?: number;
  // If a fresh read fails, a read newer than this is still trusted; older means paused.
  staleMs?: number;
  now?: () => number;
};

export function createSponsorshipGuard(options: SponsorshipGuardOptions) {
  const minBalanceWei = options.minBalanceWei ?? DEFAULT_MIN_RELAYER_BALANCE_WEI;
  const cacheMs = options.cacheMs ?? 10_000;
  const staleMs = options.staleMs ?? 60_000;
  const now = options.now ?? Date.now;
  let cached: { at: number; wei: bigint } | null = null;
  let inflight: Promise<bigint | null> | null = null;

  async function read(): Promise<bigint | null> {
    try {
      const wei = await options.getBalance();
      cached = { at: now(), wei };
      return wei;
    } catch {
      return null;
    }
  }

  async function status(): Promise<SponsorshipStatus> {
    let balanceWei: bigint | null;
    if (cached && now() - cached.at < cacheMs) {
      balanceWei = cached.wei;
    } else {
      inflight ??= read().finally(() => {
        inflight = null;
      });
      balanceWei = await inflight;
      if (balanceWei === null && cached && now() - cached.at < staleMs) balanceWei = cached.wei;
    }
    if (balanceWei === null) return { paused: true, reason: "balance-unavailable", balanceWei, minBalanceWei };
    if (balanceWei < minBalanceWei) return { paused: true, reason: "low-balance", balanceWei, minBalanceWei };
    return { paused: false, reason: null, balanceWei, minBalanceWei };
  }

  async function assertAvailable(): Promise<SponsorshipStatus> {
    const current = await status();
    if (current.paused) throw new SponsorshipPausedError(current);
    return current;
  }

  // Call after a sponsored transaction so the next check re-reads the balance.
  function invalidate() {
    cached = null;
  }

  return { status, assertAvailable, invalidate, minBalanceWei };
}
