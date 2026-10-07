import type { PlanProposal, VerifyDecision } from '@xhis/core';
import { err, isoTimestamp, ok, type Result } from '@xhis/core';
import { z } from 'zod';
import { opsVerifier } from '../verification/ops.js';
import { containerId, deploymentId, nodeId, sandboxId } from '../../instructions/ids.js';
import type { OpsEffect, OpsInstruction } from '../../instructions/types.js';

/**
 * The explicit, importable statement of the deterministic boundary a
 * shadow run is checked against — composing pieces that already exist
 * for the ops domain where one already does the job, and defining new
 * Zod schemas only where nothing runtime-checkable existed yet. `zod`
 * is a deliberate, first-of-its-kind runtime dependency for this
 * package (`@xhis/xguard`'s own `package.json`) — `@xhis/core` itself
 * stays at zero runtime dependencies; this boundary lives entirely on
 * the harness side of that split.
 *
 * **Known duplication, not hidden:** `opsInstructionSchema` below
 * re-states the same shape `agentic/validation/ops.ts`'s hand-rolled
 * `opsInstructionValidators` already enforces. Two sources of truth
 * for one shape is a real cost, accepted for this first slice rather
 * than silently reconciled — folding them into one is a follow-up, not
 * something decided here.
 *
 * `database` rules -> {@link validateShadowRunPayload}, a Zod
 * discriminated union over `OpsInstruction`'s own four `kind`s.
 *
 * `safety` rules -> {@link checkShadowRunSafety}, reusing `opsVerifier`
 * (`agentic/verification/ops.ts`) as-is — a Check decision is a
 * business rule (risk tier, blast radius), not a shape to schema-check,
 * so this stays delegation, not a new Zod schema.
 *
 * `concurrency` -> deliberately **not** re-implemented here. `act()`
 * (`@xhis/core`'s `agentic/shell/act.ts`) already re-derives every
 * commit's effect via `reexecute` against `shell.readLatest()`
 * immediately before calling `shell.commit()` — generically, for any
 * `ImperativeShell`, `ShadowOpsShell` included — and reports `'stale'`
 * if the world moved since the proposal was verified (see
 * `tests/agentic/shell/actStaleCommitRace.test.ts` in `@xhis/core` for
 * the race this closes). By the time a shell's own `commit(context,
 * effects)` runs, only the already-fresh-checked `context`/`effects`
 * remain — never the originating instructions or proposal — so there
 * is nothing a shell-level or harness-level check could re-verify
 * about staleness without either duplicating `act()`'s own logic or
 * widening `ImperativeShell` past the shape `OpsShell` and
 * `ShadowOpsShell` both already share. The one thing worth guarding at
 * the shell layer instead — a caller bypassing `act()` and invoking
 * `commit()` directly with a malformed effect — is what
 * {@link assertRecordableEffect} covers.
 */

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

/** Mirrors `agentic/validation/guards.ts`'s `isIsoTimestamp` shape check
 * exactly (same pattern, same "shape only, no `Date` parsing" restraint) —
 * expressed as a Zod schema instead of a type guard. */
const isoTimestampSchema = z.string().regex(ISO_TIMESTAMP_PATTERN, 'must be an ISO-8601 timestamp string');
const nonEmptyStringSchema = z.string().min(1, 'must be a non-empty string');
const nonNegativeIntegerSchema = z.number().int().nonnegative();

const reprovisionSandboxSchema = z.object({
  kind: z.literal('ReprovisionSandbox'),
  sandboxId: nonEmptyStringSchema,
  requestedAt: isoTimestampSchema,
});

const cordonNodeSchema = z.object({
  kind: z.literal('CordonNode'),
  nodeId: nonEmptyStringSchema,
  requestedAt: isoTimestampSchema,
});

const restartContainerSchema = z.object({
  kind: z.literal('RestartContainer'),
  containerId: nonEmptyStringSchema,
  requestedAt: isoTimestampSchema,
});

const scaleDeploymentSchema = z.object({
  kind: z.literal('ScaleDeployment'),
  deploymentId: nonEmptyStringSchema,
  replicas: nonNegativeIntegerSchema,
  requestedAt: isoTimestampSchema,
});

/** Total over `OpsInstruction`'s four variants — `z.discriminatedUnion`
 * fails to compile-time-check totality the way `satisfies
 * InstructionValidatorRegistry<OpsInstruction>` does for the hand-rolled
 * validators, so adding a fifth `OpsInstruction` kind without a matching
 * branch here is only caught by {@link OPS_INSTRUCTION_SCHEMAS_TOTALITY_CHECK}
 * below, not by this line alone. */
const opsInstructionSchema = z.discriminatedUnion('kind', [
  reprovisionSandboxSchema,
  cordonNodeSchema,
  restartContainerSchema,
  scaleDeploymentSchema,
]);

type ParsedOpsInstruction = z.infer<typeof opsInstructionSchema>;

/** Compile-time totality check Zod itself doesn't give us: this object
 * literal fails to typecheck if `OpsInstruction` ever gains a variant
 * `ParsedOpsInstruction` doesn't also cover, the identical mechanism
 * `opsRiskTiers`'s own `satisfies RiskTierRegistry<OpsInstruction>` uses. */
const OPS_INSTRUCTION_SCHEMAS_TOTALITY_CHECK: Record<OpsInstruction['kind'], true> = {
  ReprovisionSandbox: true,
  CordonNode: true,
  RestartContainer: true,
  ScaleDeployment: true,
};
void OPS_INSTRUCTION_SCHEMAS_TOTALITY_CHECK;

function toBrandedInstruction(parsed: ParsedOpsInstruction): OpsInstruction {
  switch (parsed.kind) {
    case 'ReprovisionSandbox':
      return { kind: 'ReprovisionSandbox', sandboxId: sandboxId(parsed.sandboxId), requestedAt: isoTimestamp(parsed.requestedAt) };
    case 'CordonNode':
      return { kind: 'CordonNode', nodeId: nodeId(parsed.nodeId), requestedAt: isoTimestamp(parsed.requestedAt) };
    case 'RestartContainer':
      return { kind: 'RestartContainer', containerId: containerId(parsed.containerId), requestedAt: isoTimestamp(parsed.requestedAt) };
    case 'ScaleDeployment':
      return {
        kind: 'ScaleDeployment',
        deploymentId: deploymentId(parsed.deploymentId),
        replicas: parsed.replicas,
        requestedAt: isoTimestamp(parsed.requestedAt),
      };
  }
}

export interface IndexedShadowValidationIssues {
  readonly index: number;
  readonly issues: readonly string[];
}

/**
 * The `database`/payload half of the contract: every raw candidate
 * whatever drives a shadow run is about to turn into a proposal must
 * already be a well-formed `OpsInstruction`. Same "collect every
 * failure, not just the first" and "all-or-nothing" discipline
 * `validateInstructions` (`@xhis/core`) already applies — exposed here
 * as its own explicit, Zod-backed step so a shadow run's harness code
 * can assert this *before* ever constructing a proposal.
 */
export function validateShadowRunPayload(
  candidates: readonly unknown[],
): Result<readonly OpsInstruction[], readonly IndexedShadowValidationIssues[]> {
  const instructions: OpsInstruction[] = [];
  const failures: IndexedShadowValidationIssues[] = [];

  candidates.forEach((candidate, index) => {
    const parsed = opsInstructionSchema.safeParse(candidate);
    if (parsed.success) {
      instructions.push(toBrandedInstruction(parsed.data));
    } else {
      failures.push({
        index,
        issues: parsed.error.issues.map((issue) => `'${issue.path.join('.') || '(root)'}' ${issue.message}`),
      });
    }
  });

  if (failures.length > 0) {
    return err(failures);
  }

  return ok(instructions);
}

/**
 * The `safety` half of the contract: the identical Check every
 * real-mode proposal already goes through (risk tier, then the
 * blast-radius placeholder — see `agentic/verification/ops.ts`).
 * Delegation, not a new schema — a Check decision is a business rule,
 * not a shape.
 */
export function checkShadowRunSafety(proposal: PlanProposal<OpsInstruction>): VerifyDecision {
  return opsVerifier.verify(proposal);
}

const sandboxReprovisionedEffectSchema = z.object({
  kind: z.literal('SandboxReprovisioned'),
  sandboxId: nonEmptyStringSchema,
  requestedAt: isoTimestampSchema,
});

const nodeCordonedEffectSchema = z.object({
  kind: z.literal('NodeCordoned'),
  nodeId: nonEmptyStringSchema,
  requestedAt: isoTimestampSchema,
});

const containerRestartedEffectSchema = z.object({
  kind: z.literal('ContainerRestarted'),
  containerId: nonEmptyStringSchema,
  requestedAt: isoTimestampSchema,
});

const deploymentScaledEffectSchema = z.object({
  kind: z.literal('DeploymentScaled'),
  deploymentId: nonEmptyStringSchema,
  replicas: nonNegativeIntegerSchema,
  requestedAt: isoTimestampSchema,
});

/** Total over `OpsEffect`'s four variants, the identical restraint
 * `opsInstructionSchema` above documents. */
const opsEffectSchema = z.discriminatedUnion('kind', [
  sandboxReprovisionedEffectSchema,
  nodeCordonedEffectSchema,
  containerRestartedEffectSchema,
  deploymentScaledEffectSchema,
]);

const OPS_EFFECT_SCHEMAS_TOTALITY_CHECK: Record<OpsEffect['kind'], true> = {
  SandboxReprovisioned: true,
  NodeCordoned: true,
  ContainerRestarted: true,
  DeploymentScaled: true,
};
void OPS_EFFECT_SCHEMAS_TOTALITY_CHECK;

export interface HarnessViolation {
  readonly kind: 'unrecordable-effect';
  readonly reasons: readonly string[];
}

/**
 * The one check that genuinely belongs at the shell layer, because
 * it's the one thing `commit(context, effects)` actually has in hand:
 * a runtime, Zod-backed, total-over-`OpsEffect`-kind assertion that
 * every effect about to be recorded as shadow evidence is one this
 * package actually knows about. TypeScript already guarantees this at
 * compile time for any caller going through `act()` — this is
 * defense-in-depth against a corrupted or version-skewed runtime value
 * (e.g. a caller bypassing `act()` and calling `commit()` directly),
 * the same "being deterministic doesn't exempt this from a real check"
 * discipline every validator in this codebase already applies.
 */
export function assertRecordableEffect(effect: OpsEffect): Result<OpsEffect, HarnessViolation> {
  const parsed = opsEffectSchema.safeParse(effect);
  if (!parsed.success) {
    return err({
      kind: 'unrecordable-effect',
      reasons: parsed.error.issues.map((issue) => `'${issue.path.join('.') || '(root)'}' ${issue.message}`),
    });
  }
  return ok(effect);
}
