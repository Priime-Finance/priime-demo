/**
 * Loop registry: sqlite (node:sqlite, no native dependency) records of every
 * loop and how far its deployment got. The deployer treats `step` as a
 * resume pointer, so a crash between steps re-runs only what is missing.
 */

import { DatabaseSync } from "node:sqlite";

export type LoopStep = "validated" | "handler_deployed" | "service_updated" | "active";
export type LoopStatus = "deploying" | "active" | "failed" | "inactive";

export interface LoopRecord {
  id: string;
  name: string;
  workflowId: string;
  strategist: string;
  /** Validated LoopConfig, JSON-encoded. */
  configJson: string;
  handlerAddress: string | null;
  /**
   * Hash of the pending `deployVault` tx, if we have sent one and not yet
   * decoded its receipt. Persisted BEFORE the confirmation wait so a crash
   * mid-wait resumes on the same tx (decoding `VaultCreated` from its
   * receipt), never a second deploy. `null` once `handlerAddress` is set.
   */
  deployTxHash: string | null;
  /** CID of the last service.json this loop's mutation was pinned in. */
  serviceCid: string | null;
  status: LoopStatus;
  step: LoopStep;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

interface LoopPatch {
  handlerAddress?: string | null;
  deployTxHash?: string | null;
  serviceCid?: string;
  status?: LoopStatus;
  step?: LoopStep;
  error?: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS loops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workflow_id TEXT NOT NULL UNIQUE,
  strategist TEXT NOT NULL,
  config_json TEXT NOT NULL,
  handler_address TEXT,
  deploy_tx_hash TEXT,
  service_cid TEXT,
  status TEXT NOT NULL,
  step TEXT NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_loops_strategist ON loops(strategist);
`;

interface LoopRow {
  id: string;
  name: string;
  workflow_id: string;
  strategist: string;
  config_json: string;
  handler_address: string | null;
  deploy_tx_hash: string | null;
  service_cid: string | null;
  status: string;
  step: string;
  error: string | null;
  created_at: number;
  updated_at: number;
}

function recordOf(row: LoopRow): LoopRecord {
  return {
    id: row.id,
    name: row.name,
    workflowId: row.workflow_id,
    strategist: row.strategist,
    configJson: row.config_json,
    handlerAddress: row.handler_address,
    deployTxHash: row.deploy_tx_hash,
    serviceCid: row.service_cid,
    // Stored values only ever come from the typed setters below.
    status: row.status as LoopStatus,
    step: row.step as LoopStep,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class LoopRegistry {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
    // Idempotent migration for DBs created before the deploy_tx_hash
    // column existed. SQLite has no `ADD COLUMN IF NOT EXISTS`, so we
    // ignore the duplicate-column error explicitly.
    try {
      this.db.exec("ALTER TABLE loops ADD COLUMN deploy_tx_hash TEXT");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("duplicate column name")) throw err;
    }
  }

  create(input: { id: string; name: string; workflowId: string; strategist: string; configJson: string }): LoopRecord {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO loops (id, name, workflow_id, strategist, config_json, status, step, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'deploying', 'validated', ?, ?)`,
      )
      .run(input.id, input.name, input.workflowId, input.strategist, input.configJson, now, now);
    const created = this.get(input.id);
    if (created === null) throw new Error(`registry insert lost loop ${input.id}`);
    return created;
  }

  get(id: string): LoopRecord | null {
    const row = this.db.prepare("SELECT * FROM loops WHERE id = ?").get(id);
    return row === undefined ? null : recordOf(row as unknown as LoopRow);
  }

  list(filter?: { strategist?: string }): LoopRecord[] {
    // Strategist is stored lowercased at create time (`config.ts` normalizes
    // before insert); mirror that here so a checksummed query still hits.
    const strategist = filter?.strategist?.toLowerCase();
    const rows = strategist === undefined
      ? this.db.prepare("SELECT * FROM loops ORDER BY created_at ASC").all()
      : this.db.prepare("SELECT * FROM loops WHERE strategist = ? ORDER BY created_at ASC").all(strategist);
    return rows.map((row) => recordOf(row as unknown as LoopRow));
  }

  update(id: string, patch: LoopPatch): LoopRecord {
    const sets: string[] = ["updated_at = ?"];
    const args: (string | number | null)[] = [Date.now()];
    if (patch.handlerAddress !== undefined) {
      sets.push("handler_address = ?");
      args.push(patch.handlerAddress);
    }
    if (patch.deployTxHash !== undefined) {
      sets.push("deploy_tx_hash = ?");
      args.push(patch.deployTxHash);
    }
    if (patch.serviceCid !== undefined) {
      sets.push("service_cid = ?");
      args.push(patch.serviceCid);
    }
    if (patch.status !== undefined) {
      sets.push("status = ?");
      args.push(patch.status);
    }
    if (patch.step !== undefined) {
      sets.push("step = ?");
      args.push(patch.step);
    }
    if (patch.error !== undefined) {
      sets.push("error = ?");
      args.push(patch.error);
    }
    args.push(id);
    const result = this.db.prepare(`UPDATE loops SET ${sets.join(", ")} WHERE id = ?`).run(...args);
    if (result.changes === 0) throw new Error(`loop ${id} not found`);
    const updated = this.get(id);
    if (updated === null) throw new Error(`loop ${id} vanished during update`);
    return updated;
  }

  close(): void {
    this.db.close();
  }
}
