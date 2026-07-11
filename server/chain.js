import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { injectiveEvmTestnet } from "@injectivelabs/x402/networks";
import { config } from "./config.js";

export const publicClient = createPublicClient({
  chain: injectiveEvmTestnet,
  transport: http(config.rpcUrl),
});

export const treasuryAccount = privateKeyToAccount(config.treasuryPrivateKey);

export const treasuryWalletClient = createWalletClient({
  account: treasuryAccount,
  chain: injectiveEvmTestnet,
  transport: http(config.rpcUrl),
});

export const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

/** Plain on-chain USDC transfer OUT of the treasury (payouts, not x402 — treasury already holds the key). */
export async function payoutUsdc(to, amountUnits) {
  const hash = await treasuryWalletClient.writeContract({
    address: config.usdcAddress,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [to, amountUnits],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, status: receipt.status };
}

export async function usdcBalanceOf(address) {
  return publicClient.readContract({
    address: config.usdcAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address],
  });
}
