import { privateKeyToAccount } from "viem/accounts";

const TOKEN = "b149911a4e3944397155a6991ee2096cc58c6b5a8dbf98e8";
const strategist = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const attacker = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");

const domain = { name: "PriimeLoopServer", version: "1", chainId: 8453, verifyingContract: "0x23d382E3c6b1625B0021d5ef291DBd12995cDf00" };
const publishTypes = {
  LoopPublish: [
    { name: "strategist", type: "address" },
    { name: "name", type: "string" },
    { name: "candidateId", type: "string" },
    { name: "cronSeconds", type: "uint32" },
    { name: "targetLeverage", type: "uint32" },
    { name: "signedAt", type: "uint64" },
  ],
};

const nowBase = Math.floor(Date.now() / 1000);

async function probe(label, key, chainId, signedAt) {
  const dom = { ...domain, chainId };
  const msg = {
    strategist: strategist.address,
    name: "signed-e2e",
    candidateId: "morpho-blue-base:8453:USDe-USDC:0x54cf9be5",
    cronSeconds: 60,
    targetLeverage: 25000,
    signedAt: BigInt(signedAt),
  };
  const sig = await key.signTypedData({ domain: dom, types: publishTypes, primaryType: "LoopPublish", message: msg });
  const body = {
    name: "signed-e2e",
    strategist: strategist.address,
    cronSeconds: 60,
    candidateId: "morpho-blue-base:8453:USDe-USDC:0x54cf9be5",
    targetLeverage: 2.5,
    signedAt,
    signature: sig,
  };
  const res = await fetch("http://127.0.0.1:8090/loops", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  console.log(`${label}: ${res.status}  ${(await res.text()).slice(0, 220)}`);
}

console.log("=== attacker key signs while claiming strategist ===");
await probe("  attacker key", attacker, 8453, nowBase);
console.log("\n=== strategist signs on wrong chain (domain replay) ===");
await probe("  strategist, chainId=1", strategist, 1, nowBase);
console.log("\n=== strategist signs 6 min ago (stale) ===");
await probe("  strategist, stale", strategist, 8453, nowBase - 360);
console.log("\n=== strategist signs, right chain, fresh ===");
await probe("  strategist, valid", strategist, 8453, nowBase);
