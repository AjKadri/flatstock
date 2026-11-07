// Relayed writes that cannot report a false failure. The transaction is signed locally once, its hash is computed
// from the signed bytes, and only then is it broadcast. If the broadcast throws (provider A times out after
// accepting the tx, provider B answers "already known" or "nonce too low"), the hash is looked up on chain for a few
// seconds; if the transaction exists we return its hash as success. We never sign a second time on retry, so the same
// nonce can never be used for two different transactions.
import { encodeFunctionData, keccak256, type Abi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";

export type WriteRequest = { address: Address; abi: Abi | readonly unknown[]; functionName: string; args: readonly unknown[] };

type Deps = {
  walletClient: WalletClient;
  publicClient: PublicClient;
  /** Look-up attempts after a failed broadcast, and the pause between them. */
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createRelayedSender({ walletClient, publicClient, attempts = 8, delayMs = 1_000, sleep = pause }: Deps) {
  // True once any node we can reach knows the transaction (pending or mined).
  async function exists(hash: Hex): Promise<boolean> {
    try {
      const tx = await publicClient.request({ method: "eth_getTransactionByHash", params: [hash] } as never);
      if (tx) return true;
    } catch { /* try the receipt */ }
    try {
      const receipt = await publicClient.request({ method: "eth_getTransactionReceipt", params: [hash] } as never);
      return Boolean(receipt);
    } catch {
      return false;
    }
  }

  async function writeContract(request: WriteRequest): Promise<Hex> {
    const data = encodeFunctionData({ abi: request.abi as Abi, functionName: request.functionName, args: request.args as never });
    // Nonce, gas and fees are chosen once, here. Estimation also reverts early when the call would fail.
    const prepared = await walletClient.prepareTransactionRequest({ to: request.address, data, account: walletClient.account!, chain: walletClient.chain } as never);
    const serialized = await walletClient.signTransaction(prepared as never);
    const hash = keccak256(serialized);
    try {
      await walletClient.sendRawTransaction({ serializedTransaction: serialized });
      return hash;
    } catch (error) {
      for (let i = 0; i < attempts; i += 1) {
        if (await exists(hash)) return hash;
        if (i < attempts - 1) await sleep(delayMs);
      }
      throw error; // really not on chain: report the original error, and do not re-sign
    }
  }

  return { writeContract };
}
