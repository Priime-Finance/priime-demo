/**
 * service.json mutation for Option A: one shared Priime service, one workflow
 * per loop.
 *
 * The builder never constructs a workflow from scratch. It CLONES an
 * existing template workflow (the one vault-service.sh deployed) and swaps
 * only the fields that vary per loop: the cron window, the vault-nav
 * component config, and the aggregator's submit target. Everything else --
 * component sources, digests, permissions, limits, signature kind, unknown
 * future fields -- passes through verbatim, so this code cannot drift from
 * the runtime's serde schema.
 *
 * Documents are parsed with parseLossless (Timestamp nanos exceed 2^53) and
 * treated as opaque JSON with narrow, validated accessors.
 */

import { isRecord } from "./guards.ts";

/** Matches priime_types WorkflowId: `[a-z0-9-_]{3,36}`. */
const WORKFLOW_ID_RE = /^[a-z0-9_-]{3,36}$/;

export class ServiceDocError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceDocError";
  }
}

export interface CronWindow {
  schedule: string;
  startTimeNanos: bigint;
  endTimeNanos: bigint;
}

export interface WorkflowSpec {
  workflowId: string;
  /** Merged over the template component's config (full key wins). */
  componentConfig: Record<string, string>;
  /** Replaces the aggregator component's config: { [chainKey]: handler }. */
  aggregatorTarget: { chainKey: string; handler: string };
  cron: CronWindow;
}

export function newWorkflowId(): string {
  /* Web Crypto (`crypto.getRandomValues`) instead of `node:crypto`
     `randomBytes`: `node:crypto` is a Node-only scheme and webpack
     refuses to bundle it for a browser build, which is what tanks
     `apps/replay-ui`'s `/build` and `/portfolio` routes with an
     `UnhandledSchemeError`. Web Crypto is browser-native and Node
     19+ ships it as a top-level global, so the same function works
     in every consumer without a per-platform branch.
     `hl-scan`/`serialize.contentHash` use the SAME API for the same
     reason (see `lib/canvas/scenario/hash.ts` for the port note). */
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `loop-${hex}`;
}

/** The workflows map of a parsed service document. */
function workflowsOf(doc: unknown): Record<string, unknown> {
  if (!isRecord(doc)) throw new ServiceDocError("service document is not an object");
  const workflows = doc.workflows;
  if (!isRecord(workflows)) throw new ServiceDocError("service document has no workflows map");
  return workflows;
}

export function workflowIds(doc: unknown): string[] {
  return Object.keys(workflowsOf(doc));
}

/**
 * Clone `templateWorkflowId` into a new workflow per `spec`. Returns a new
 * document; the input is not modified. When `templateWorkflowId` is omitted
 * the service must contain exactly one workflow, which becomes the template.
 */
export function addLoopWorkflow(doc: unknown, spec: WorkflowSpec, templateWorkflowId?: string): unknown {
  if (!WORKFLOW_ID_RE.test(spec.workflowId)) {
    throw new ServiceDocError(`workflow id ${JSON.stringify(spec.workflowId)} violates [a-z0-9_-]{3,36}`);
  }
  const next = structuredClone(doc);
  const workflows = workflowsOf(next);

  if (workflows[spec.workflowId] !== undefined) {
    throw new ServiceDocError(`workflow ${spec.workflowId} already exists in the service`);
  }

  let templateId = templateWorkflowId;
  if (templateId === undefined) {
    const ids = Object.keys(workflows);
    if (ids.length !== 1) {
      throw new ServiceDocError(`template workflow id required: service has ${ids.length} workflows`);
    }
    templateId = ids[0]!;
  }
  const template = workflows[templateId];
  if (!isRecord(template)) throw new ServiceDocError(`template workflow ${templateId} not found`);

  const workflow = structuredClone(template);

  // Trigger: must be a cron trigger; rewrite the schedule and window.
  if (!isRecord(workflow.trigger) || !isRecord(workflow.trigger.cron)) {
    throw new ServiceDocError(`template workflow ${templateId} has no cron trigger`);
  }
  workflow.trigger.cron.schedule = spec.cron.schedule;
  workflow.trigger.cron.start_time = spec.cron.startTimeNanos;
  workflow.trigger.cron.end_time = spec.cron.endTimeNanos;

  // Component config: template config with per-loop keys merged over it.
  if (!isRecord(workflow.component)) {
    throw new ServiceDocError(`template workflow ${templateId} has no component`);
  }
  const templateConfig = isRecord(workflow.component.config) ? workflow.component.config : {};
  workflow.component.config = { ...templateConfig, ...spec.componentConfig };

  // Submit target: the aggregator component's config carries { chainKey: handler }.
  if (!isRecord(workflow.submit) || !isRecord(workflow.submit.aggregator) || !isRecord(workflow.submit.aggregator.component)) {
    throw new ServiceDocError(`template workflow ${templateId} has no aggregator submit`);
  }
  workflow.submit.aggregator.component.config = {
    [spec.aggregatorTarget.chainKey]: spec.aggregatorTarget.handler,
  };

  workflows[spec.workflowId] = workflow;
  return next;
}

/**
 * Remove a loop workflow. Returns a new document. `protectedIds` (the
 * template and any system workflows) cannot be removed.
 */
export function removeLoopWorkflow(doc: unknown, workflowId: string, protectedIds: readonly string[] = []): unknown {
  if (protectedIds.includes(workflowId)) {
    throw new ServiceDocError(`workflow ${workflowId} is protected and cannot be removed`);
  }
  const next = structuredClone(doc);
  const workflows = workflowsOf(next);
  if (workflows[workflowId] === undefined) {
    throw new ServiceDocError(`workflow ${workflowId} does not exist in the service`);
  }
  delete workflows[workflowId];
  return next;
}

/**
 * Rescue workflows a competing writer added between our doc fetch and
 * our own `setServiceURI`. Copies every workflow entry present in
 * `donor` but not in `target`, verbatim. The runtime treats each
 * workflow as an opaque document (see `addLoopWorkflow`'s narrow field
 * writes above), so `structuredClone` is safe: no serde reshaping.
 *
 * Used by `LoopDeployer.mutateService`'s optimistic-concurrency retry:
 * once we detect that our `setServiceURI` overwrote a `ServiceURIUpdated`
 * event landed in the window, we fetch each clobbered URI's doc, merge
 * its unknown workflows into our own edited doc, and re-pin+re-set.
 */
export function mergeMissingWorkflows(target: unknown, donor: unknown): unknown {
  const targetWorkflows = workflowsOf(target);
  const donorWorkflows = workflowsOf(donor);
  const missing = Object.keys(donorWorkflows).filter((id) => targetWorkflows[id] === undefined);
  if (missing.length === 0) return target;
  const next = structuredClone(target);
  const nextWorkflows = workflowsOf(next);
  for (const id of missing) {
    // structuredClone is applied by the outer clone above; the donor
    // entry is already a fresh subtree.
    nextWorkflows[id] = structuredClone(donorWorkflows[id]);
  }
  return next;
}
