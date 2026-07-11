import "dotenv/config";

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  network: required("NETWORK"),
  rpcUrl: required("RPC_URL"),
  usdcAddress: required("USDC_ADDRESS"),
  port: Number(process.env.PORT || 4021),
  treasuryPrivateKey: required("TREASURY_PRIVATE_KEY"),
  treasuryAddress: required("TREASURY_ADDRESS"),
  internalSecret: required("INTERNAL_SECRET"),
};
