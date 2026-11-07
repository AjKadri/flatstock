// Ordered RPC providers with failover, for general reads only. Order: GetBlock, QuickNode, public RPC.
// A provider that fails (network error, timeout, HTTP 429/5xx) is skipped for a cool-down so the next
// requests do not wait on it, and is tried last rather than dropped, so "the reverse" also works: if
// GetBlock is down QuickNode serves, and if QuickNode is down GetBlock serves.
// The Stock Token API (qn_*) never goes through here: it stays QuickNode-only.
// URLs are secrets (they can carry an API key): nothing here puts a URL in a message or a log.
export type ProviderName = "getblock" | "quicknode" | "public";
export type Provider = { name: ProviderName; url: string };

export function buildProviders(env: { GETBLOCK_RPC_URL?: string; QUICKNODE_RPC_URL?: string; RPC_URL?: string }, publicDefault: string): Provider[] {
  const list: Provider[] = [];
  const add = (name: ProviderName, url: string | undefined) => {
    const value = url?.trim();
    if (value && !list.some((item) => item.url === value)) list.push({ name, url: value });
  };
  add("getblock", env.GETBLOCK_RPC_URL);
  add("quicknode", env.QUICKNODE_RPC_URL);
  add("public", env.RPC_URL?.trim() || publicDefault);
  return list;
}

export class ProvidersFailedError extends Error {}

type Options = {
  providers: Provider[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  cooldownMs?: number;
  now?: () => number;
};

const hasRpcError = (result: unknown) =>
  Array.isArray(result)
    ? result.some((item) => typeof item === "object" && item !== null && "error" in item)
    : typeof result === "object" && result !== null && "error" in result;

export function createProviderPool({ providers, fetchImpl = fetch, timeoutMs = 8_000, cooldownMs = 30_000, now = Date.now }: Options) {
  const downUntil = new Map<string, number>();
  const probe = new Map<string, { ok: boolean; at: number }>();

  const ordered = () => {
    const t = now();
    const up = providers.filter((p) => (downUntil.get(p.name) ?? 0) <= t);
    const down = providers.filter((p) => (downUntil.get(p.name) ?? 0) > t);
    return [...up, ...down];
  };

  async function send(provider: Provider, payload: unknown) {
    const response = await fetchImpl(provider.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const transportOk = response.ok;
    let result: unknown;
    try { result = JSON.parse(await response.text()); } catch { result = undefined; }
    return { transportOk, result, status: response.status };
  }

  // Forward a (already policy-checked) JSON-RPC payload; returns the first good answer.
  async function forward(payload: unknown): Promise<{ result: unknown; provider: ProviderName }> {
    const failed: string[] = [];
    for (const provider of ordered()) {
      try {
        const { transportOk, result, status } = await send(provider, payload);
        if (!transportOk || result === undefined) {
          downUntil.set(provider.name, now() + cooldownMs);
          failed.push(`${provider.name} HTTP ${status}`);
          continue;
        }
        if (hasRpcError(result)) {
          // The provider answered; a JSON-RPC error is not an outage, but try the next one in case it is provider-specific.
          failed.push(`${provider.name} returned an RPC error`);
          continue;
        }
        downUntil.delete(provider.name);
        return { result, provider: provider.name };
      } catch {
        downUntil.set(provider.name, now() + cooldownMs);
        failed.push(`${provider.name} unreachable`);
      }
    }
    throw new ProvidersFailedError(`RPC proxy failed (${failed.join("; ") || "no provider configured"}).`);
  }

  // Cheap liveness probe (eth_chainId), cached for 30 s, for /api/health.
  async function health(): Promise<Record<ProviderName, boolean>> {
    const out: Record<ProviderName, boolean> = { getblock: false, quicknode: false, public: false };
    await Promise.all(providers.map(async (provider) => {
      const cached = probe.get(provider.name);
      if (cached && now() - cached.at < 30_000) { out[provider.name] = cached.ok; return; }
      let ok = false;
      try {
        const { transportOk, result } = await send(provider, { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
        ok = transportOk && !hasRpcError(result) && (result as { result?: string })?.result === "0x1237";
      } catch { ok = false; }
      probe.set(provider.name, { ok, at: now() });
      out[provider.name] = ok;
    }));
    return out;
  }

  return { forward, health, ordered };
}
