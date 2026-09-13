import { privateKeyToAccount } from "viem/accounts";

const TOKEN = "b149911a4e3944397155a6991ee2096cc58c6b5a8dbf98e8";
const strategist = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const attacker = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");

const domain = { name: "PriimeLoopServer", version: "1", chainId: 8453, verifyingContract: "0x23d382E3c6b1625B0021d5ef291DBd12995cDf00" };
const pauseTypes = {
  LoopPause: [
    { name: "loopId", type: "string" },
    { name: "signedAt", type: "uint64" },
  ],
};

async function pause(label, key, loopId, signedAt) {
  const msg = { loopId, signedAt: BigInt(signedAt) };
  const sig = await key.signTypedData({ domain, types: pauseTypes, primaryType: "LoopPause", message: msg });
  const url = `http://127.0.0.1:8090/loops/${encodeURIComponent(loopId)}?signature=${encodeURIComponent(sig)}&signedAt=${signedAt}`;
  const res = await fetch(url, { method: "DELETE", headers: { authorization: `Bearer ${TOKEN}` } });
  console.log(`${label}: ${res.status}  ${(await res.text()).slice(0, 200)}`);
}

const LOOP = "loop-5dc3d5b4";
const now = Math.floor(Date.now() / 1000);

console.log("=== attacker key signs a pause for someone else's loop ===");
await pause("  attacker", attacker, LOOP, now);
console.log("\n=== stale signature ===");
await pause("  stale", strategist, LOOP, now - 400);
console.log("\n=== strategist signs a valid pause (cleans up the test loop) ===");
await pause("  strategist", strategist, LOOP, now);
console.log("\n=== attempting to pause an already-inactive loop (idempotent) ===");
await pause("  strategist redo", strategist, LOOP, now);
