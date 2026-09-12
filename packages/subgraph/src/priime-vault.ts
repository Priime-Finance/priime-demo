// AssemblyScript mappings for the PriimeVault subgraph.
//
// Every handler ensures the singleton Vault entity exists (lazy init on first event), writes the immutable event row, and bumps the rolling Vault counters plus the day-bucketed VaultDailyMetric.

import { Address, BigInt, Bytes, ethereum, log } from "@graphprotocol/graph-ts";
import {
  Deleveraged,
  DepositRequest,
  DepositRequestFulfilled,
  DepositRequestRefunded,
  Executed,
  NavUpdated,
  PlanExecuted,
  PlanRejected,
  PriimeVault,
  RedeemRequest,
  RedeemRequestFulfilled,
} from "../generated/PriimeVault/PriimeVault";
import {
  Deleverage,
  DepositFulfilled,
  DepositRefunded,
  ExecuteCall,
  PlanExecution,
  PlanRejection,
  RedeemFulfilled,
  Strike,
  Vault,
  VaultDailyMetric,
  VaultDepositRequest,
  VaultRedeemRequest,
} from "../generated/schema";

const SECONDS_PER_DAY = BigInt.fromI32(86400);

function ensureVault(address: Address, event: ethereum.Event): Vault {
  let id = address as Bytes;
  let vault = Vault.load(id);
  if (vault != null) return vault;

  vault = new Vault(id);
  vault.address = id;
  vault.createdBlock = event.block.number;
  vault.createdTimestamp = event.block.timestamp;

  // Read the immutables straight off the contract. Cheap since it happens once.
  let bound = PriimeVault.bind(address);
  let asset = bound.try_asset();
  vault.asset = asset.reverted ? Bytes.empty() : (asset.value as Bytes);
  let strategist = bound.try_strategist();
  vault.strategist = strategist.reverted ? Bytes.empty() : (strategist.value as Bytes);
  let sm = bound.try_serviceManager();
  vault.serviceManager = sm.reverted ? Bytes.empty() : (sm.value as Bytes);
  let router = bound.try_swapRouter();
  vault.swapRouter = router.reverted ? Bytes.empty() : (router.value as Bytes);
  let fee = bound.try_poolFee();
  vault.poolFee = fee.reverted ? 0 : fee.value;

  vault.totalShares = BigInt.zero();
  vault.totalDepositRequested = BigInt.zero();
  vault.totalDepositFulfilled = BigInt.zero();
  vault.totalRedeemRequested = BigInt.zero();
  vault.totalRedeemFulfilled = BigInt.zero();
  vault.lastNav = BigInt.zero();
  vault.lastInputsBlock = BigInt.zero();
  vault.updateCount = BigInt.zero();
  vault.breachFlags = 0;
  vault.save();
  return vault;
}

function dayBucket(vaultAddress: Bytes, ts: BigInt): VaultDailyMetric {
  let day = ts.div(SECONDS_PER_DAY).times(SECONDS_PER_DAY);
  let id = vaultAddress.concat(Bytes.fromByteArray(Bytes.fromBigInt(day)));
  let m = VaultDailyMetric.load(id);
  if (m != null) return m;
  m = new VaultDailyMetric(id);
  m.vault = vaultAddress;
  m.day = day;
  m.strikeCount = 0;
  m.navEnd = BigInt.zero();
  m.navMin = BigInt.zero();
  m.navMax = BigInt.zero();
  m.depositRequests = 0;
  m.redeemRequests = 0;
  m.depositsFulfilled = BigInt.zero();
  m.redeemsFulfilled = BigInt.zero();
  m.planExecuted = 0;
  m.planRejected = 0;
  m.save();
  return m;
}

function logId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32());
}

export function handleNavUpdated(event: NavUpdated): void {
  let vault = ensureVault(event.address, event);
  let strike = new Strike(event.params.eventId as Bytes);
  strike.vault = vault.id;
  strike.eventId = event.params.eventId;
  strike.nav = event.params.nav;
  strike.inputsBlock = event.params.inputsBlock;
  strike.updateCount = event.params.updateCount;
  strike.configHash = event.params.configHash;
  strike.leverageBps = event.params.leverageBps.toI32();
  strike.ltvBps = event.params.ltvBps.toI32();
  strike.reserveBps = event.params.reserveBps.toI32();
  strike.supplyApyBps = event.params.supplyApyBps.toI32();
  strike.hoursSinceUpdate = event.params.hoursSinceUpdate.toI32();
  strike.breachFlags = event.params.breachFlags;
  strike.block = event.block.number;
  strike.timestamp = event.block.timestamp;
  strike.tx = event.transaction.hash;
  strike.save();

  vault.lastNav = event.params.nav;
  vault.lastInputsBlock = event.params.inputsBlock;
  vault.updateCount = event.params.updateCount;
  vault.breachFlags = event.params.breachFlags;
  vault.save();

  let m = dayBucket(vault.id, event.block.timestamp);
  m.strikeCount += 1;
  m.navEnd = event.params.nav;
  if (m.navMin.isZero() || event.params.nav.lt(m.navMin)) m.navMin = event.params.nav;
  if (event.params.nav.gt(m.navMax)) m.navMax = event.params.nav;
  m.save();
}

export function handleDepositRequest(event: DepositRequest): void {
  let vault = ensureVault(event.address, event);
  let e = new VaultDepositRequest(logId(event));
  e.vault = vault.id;
  e.controller = event.params.controller;
  e.owner = event.params.owner;
  e.sender = event.params.sender;
  e.requestId = event.params.requestId;
  e.assets = event.params.assets;
  e.block = event.block.number;
  e.timestamp = event.block.timestamp;
  e.tx = event.transaction.hash;
  e.save();

  vault.totalDepositRequested = vault.totalDepositRequested.plus(event.params.assets);
  vault.save();

  let m = dayBucket(vault.id, event.block.timestamp);
  m.depositRequests += 1;
  m.save();
}

export function handleRedeemRequest(event: RedeemRequest): void {
  let vault = ensureVault(event.address, event);
  let e = new VaultRedeemRequest(logId(event));
  e.vault = vault.id;
  e.controller = event.params.controller;
  e.owner = event.params.owner;
  e.sender = event.params.sender;
  e.requestId = event.params.requestId;
  e.shares = event.params.shares;
  e.block = event.block.number;
  e.timestamp = event.block.timestamp;
  e.tx = event.transaction.hash;
  e.save();

  vault.totalRedeemRequested = vault.totalRedeemRequested.plus(event.params.shares);
  vault.save();

  let m = dayBucket(vault.id, event.block.timestamp);
  m.redeemRequests += 1;
  m.save();
}

export function handleDepositRequestFulfilled(event: DepositRequestFulfilled): void {
  let vault = ensureVault(event.address, event);
  let e = new DepositFulfilled(logId(event));
  e.vault = vault.id;
  e.controller = event.params.controller;
  e.assets = event.params.assets;
  e.shares = event.params.shares;
  e.block = event.block.number;
  e.timestamp = event.block.timestamp;
  e.tx = event.transaction.hash;
  e.save();

  vault.totalDepositFulfilled = vault.totalDepositFulfilled.plus(event.params.assets);
  vault.totalShares = vault.totalShares.plus(event.params.shares);
  vault.save();

  let m = dayBucket(vault.id, event.block.timestamp);
  m.depositsFulfilled = m.depositsFulfilled.plus(event.params.assets);
  m.save();
}

export function handleRedeemRequestFulfilled(event: RedeemRequestFulfilled): void {
  let vault = ensureVault(event.address, event);
  let e = new RedeemFulfilled(logId(event));
  e.vault = vault.id;
  e.controller = event.params.controller;
  e.shares = event.params.shares;
  e.assets = event.params.assets;
  e.block = event.block.number;
  e.timestamp = event.block.timestamp;
  e.tx = event.transaction.hash;
  e.save();

  vault.totalRedeemFulfilled = vault.totalRedeemFulfilled.plus(event.params.assets);
  if (vault.totalShares.ge(event.params.shares)) {
    vault.totalShares = vault.totalShares.minus(event.params.shares);
  }
  vault.save();

  let m = dayBucket(vault.id, event.block.timestamp);
  m.redeemsFulfilled = m.redeemsFulfilled.plus(event.params.assets);
  m.save();
}

export function handleDepositRequestRefunded(event: DepositRequestRefunded): void {
  let vault = ensureVault(event.address, event);
  let e = new DepositRefunded(logId(event));
  e.vault = vault.id;
  e.controller = event.params.controller;
  e.assets = event.params.assets;
  e.block = event.block.number;
  e.timestamp = event.block.timestamp;
  e.tx = event.transaction.hash;
  e.save();
}

export function handleExecuted(event: Executed): void {
  let vault = ensureVault(event.address, event);
  let e = new ExecuteCall(logId(event));
  e.vault = vault.id;
  e.target = event.params.target;
  e.data = event.params.data;
  e.block = event.block.number;
  e.timestamp = event.block.timestamp;
  e.tx = event.transaction.hash;
  e.save();
}

export function handlePlanExecuted(event: PlanExecuted): void {
  let vault = ensureVault(event.address, event);
  let e = new PlanExecution(logId(event));
  e.vault = vault.id;
  e.planHash = event.params.planHash;
  e.stepCount = event.params.stepCount;
  e.block = event.block.number;
  e.timestamp = event.block.timestamp;
  e.tx = event.transaction.hash;
  e.save();

  let m = dayBucket(vault.id, event.block.timestamp);
  m.planExecuted += 1;
  m.save();
}

export function handlePlanRejected(event: PlanRejected): void {
  let vault = ensureVault(event.address, event);
  let e = new PlanRejection(logId(event));
  e.vault = vault.id;
  e.planHash = event.params.planHash;
  e.reason = event.params.reason;
  e.block = event.block.number;
  e.timestamp = event.block.timestamp;
  e.tx = event.transaction.hash;
  e.save();

  let m = dayBucket(vault.id, event.block.timestamp);
  m.planRejected += 1;
  m.save();
}

export function handleDeleveraged(event: Deleveraged): void {
  let vault = ensureVault(event.address, event);
  let e = new Deleverage(logId(event));
  e.vault = vault.id;
  e.flashAssets = event.params.flashAssets;
  e.collateralOut = event.params.collateralOut;
  e.usdcOut = event.params.usdcOut;
  e.block = event.block.number;
  e.timestamp = event.block.timestamp;
  e.tx = event.transaction.hash;
  e.save();
}
