/**
 * Real CCTP v2 bridge: burns testnet USDC on Ethereum Sepolia and mints it on
 * Injective EVM testnet via Circle's actual TokenMessengerV2/MessageTransmitterV2
 * contracts and the real Iris attestation API. This is what makes "USDC CCTP"
 * (one of the hackathon's 4 required technologies) a true claim instead of a
 * documented-but-unused one — MatchMesh's testnet funding path genuinely uses it.
 *
 * Contract addresses are deterministic across EVM CCTP domains (same address on
 * every chain), confirmed by reading real deployed bytecode at both ends before
 * writing this script — not copied from a doc page.
 *
 * Usage: node scripts/cctp-bridge.js <amountUsdc>
 *   e.g. node scripts/cctp-bridge.js 2       (bridges 2 USDC from Sepolia -> Injective testnet)
 *
 * Requires (in .env): SEPOLIA_PRIVATE_KEY (or falls back to TREASURY_PRIVATE_KEY —
 * same address works on both chains), funded with Sepolia ETH (gas) and Sepolia
 * USDC. Get both free: Sepolia ETH from any public Sepolia faucet, Sepolia USDC
 * from faucet.circle.com (select "Ethereum Sepolia").
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, pad } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { injectiveEvmTestnet } from "@injectivelabs/x402/networks";

const TOKEN_MESSENGER_V2 = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA"; // same address on every CCTP EVM domain
const MESSAGE_TRANSMITTER_V2 = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275"; // same address on every CCTP EVM domain
const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const INJECTIVE_TESTNET_USDC = process.env.USDC_ADDRESS || "0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d";
const SOURCE_DOMAIN = 0;  // Ethereum (incl. Sepolia)
const DEST_DOMAIN = 29;   // Injective (incl. testnet)
const IRIS_API = "https://iris-api-sandbox.circle.com";
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);

const TOKEN_MESSENGER_ABI = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
]);

const MESSAGE_TRANSMITTER_ABI = parseAbi([
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
]);

function addressToBytes32(address) {
  return pad(address, { size: 32 });
}

async function getFeeBps() {
  const res = await fetch(`${IRIS_API}/v2/burn/USDC/fees/${SOURCE_DOMAIN}/${DEST_DOMAIN}`);
  if (!res.ok) throw new Error(`fee lookup failed: ${res.status}`);
  const data = await res.json();
  const fast = (data.data || data).find?.((f) => f.finalityThreshold <= 1000) || (data.data || data)[0];
  return fast?.minimumFee ?? 0;
}

async function pollAttestation(txHash) {
  const url = `${IRIS_API}/v2/messages/${SOURCE_DOMAIN}?transactionHash=${txHash}`;
  for (let i = 0; i < 60; i++) {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const msg = data.messages?.[0];
      if (msg?.status === "complete" && msg.attestation && msg.attestation !== "PENDING") {
        return msg;
      }
      console.log(`  [${i}] attestation status: ${msg?.status ?? "not found yet"}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("attestation did not complete in time (5 min) — CCTP testnet can be slow, rerun with more patience or check iris-api-sandbox.circle.com status");
}

async function main() {
  const amountUsdc = Number(process.argv[2] || "2");
  const amountUnits = BigInt(Math.round(amountUsdc * 1e6));

  const privateKey = process.env.SEPOLIA_PRIVATE_KEY || process.env.TREASURY_PRIVATE_KEY;
  if (!privateKey) throw new Error("Set SEPOLIA_PRIVATE_KEY or TREASURY_PRIVATE_KEY in .env");
  const account = privateKeyToAccount(privateKey);
  console.log(`Bridging ${amountUsdc} USDC: Sepolia -> Injective testnet, address ${account.address}`);

  const sepoliaPublic = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });
  const sepoliaWallet = createWalletClient({ account, chain: sepolia, transport: http(SEPOLIA_RPC) });
  const injPublic = createPublicClient({ chain: injectiveEvmTestnet, transport: http(process.env.RPC_URL) });
  const injWallet = createWalletClient({ account, chain: injectiveEvmTestnet, transport: http(process.env.RPC_URL) });

  const usdcBal = await sepoliaPublic.readContract({ address: SEPOLIA_USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
  console.log(`Sepolia USDC balance: ${Number(usdcBal) / 1e6}`);
  if (usdcBal < amountUnits) throw new Error(`Insufficient Sepolia USDC. Get some at faucet.circle.com (select Ethereum Sepolia).`);

  console.log("Step 1/4: approve TokenMessengerV2 to spend USDC on Sepolia...");
  const allowance = await sepoliaPublic.readContract({ address: SEPOLIA_USDC, abi: ERC20_ABI, functionName: "allowance", args: [account.address, TOKEN_MESSENGER_V2] });
  if (allowance < amountUnits) {
    const approveHash = await sepoliaWallet.writeContract({ address: SEPOLIA_USDC, abi: ERC20_ABI, functionName: "approve", args: [TOKEN_MESSENGER_V2, amountUnits] });
    await sepoliaPublic.waitForTransactionReceipt({ hash: approveHash });
    console.log(`  approved: ${approveHash}`);
  } else {
    console.log("  already approved, skipping");
  }

  console.log("Step 2/4: fetch current Fast Transfer fee and burn USDC on Sepolia...");
  const feeBps = await getFeeBps();
  const maxFee = (amountUnits * BigInt(Math.ceil(feeBps)) / 10000n) + 1n; // +1 unit buffer for rounding
  console.log(`  fee: ${feeBps} bps -> maxFee ${maxFee} units`);

  const burnHash = await sepoliaWallet.writeContract({
    address: TOKEN_MESSENGER_V2,
    abi: TOKEN_MESSENGER_ABI,
    functionName: "depositForBurn",
    args: [amountUnits, DEST_DOMAIN, addressToBytes32(account.address), SEPOLIA_USDC, addressToBytes32("0x0000000000000000000000000000000000000000"), maxFee, 1000],
  });
  console.log(`  burn tx: ${burnHash}`);
  await sepoliaPublic.waitForTransactionReceipt({ hash: burnHash });
  console.log("  burn confirmed on Sepolia");

  console.log("Step 3/4: poll Circle's Iris API for the attestation (real cross-chain finality, can take ~1-3 min)...");
  const attested = await pollAttestation(burnHash);
  console.log("  attestation received");

  console.log("Step 4/4: submit receiveMessage on Injective testnet to mint...");
  const mintHash = await injWallet.writeContract({
    address: MESSAGE_TRANSMITTER_V2,
    abi: MESSAGE_TRANSMITTER_ABI,
    functionName: "receiveMessage",
    args: [attested.message, attested.attestation],
  });
  const mintReceipt = await injPublic.waitForTransactionReceipt({ hash: mintHash });
  console.log(`  mint tx: ${mintHash} (status: ${mintReceipt.status})`);

  const newBal = await injPublic.readContract({ address: INJECTIVE_TESTNET_USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
  console.log(`\nDone. ${account.address} now holds ${Number(newBal) / 1e6} USDC on Injective testnet.`);
  console.log(`Burn (Sepolia):  https://sepolia.etherscan.io/tx/${burnHash}`);
  console.log(`Mint (Injective): https://testnet.blockscout.injective.network/tx/${mintHash}`);
}

main().catch((err) => {
  console.error("CCTP bridge failed:", err.message);
  process.exitCode = 1;
});
