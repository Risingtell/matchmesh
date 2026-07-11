import "dotenv/config";
import { createInjectiveClient } from "@injectivelabs/x402/client";

export const BASE_URL = process.env.MATCHMESH_URL || `http://localhost:${process.env.PORT || 4021}`;

export function makeClient(privateKeyEnv) {
  const privateKey = process.env[privateKeyEnv];
  if (!privateKey) throw new Error(`Missing ${privateKeyEnv} in .env`);
  return createInjectiveClient({
    privateKey,
    rpcUrl: process.env.RPC_URL,
    preferredNetworks: [process.env.NETWORK ?? "eip155:1439"],
  });
}

/**
 * Injective's testnet EVM RPC has observed indexing lag: a settlement can
 * genuinely succeed on-chain (nonce advances, funds move) while the
 * facilitator's receipt lookup still reports "could not be found" and the
 * request fails or hangs. EIP-3009 authorizations are single-use (random
 * nonce, replay-safe), so retrying is safe — a stale authorization would just
 * be rejected on-chain, never double-charged. Wrap any x402 client.fetch call
 * with this to ride out the lag instead of surfacing a false failure.
 */
export async function withRetry(fn, { attempts = 3, delayMs = 4000, timeoutMs = 25_000 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`attempt timed out after ${timeoutMs}ms`)), timeoutMs)),
      ]);
    } catch (err) {
      lastErr = err;
      console.warn(`[retry ${i + 1}/${attempts}] ${err.message}`);
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
