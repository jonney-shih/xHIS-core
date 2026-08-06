import type { RawPlanner, RawPlanOutput, Result, TelemetryEvent } from '@xhis/core';
import { ok } from '@xhis/core';

/**
 * The rule-based, no-LLM ops planner — mirrors `@xhis/core`'s own
 * `cdssBedPlanner.ts`/`cdssLabPlanner.ts` style exactly: a deterministic
 * rule implementing the untrusted `RawPlanner<TCtx>` contract, producing
 * raw, still-unvalidated candidate instructions that must still pass
 * `agentic/validation/ops.ts`'s gate before becoming a trusted
 * `OpsInstruction` — "being deterministic doesn't exempt this output
 * from the same validation gate an LLM's raw JSON would have to pass
 * through," the identical claim every clinical CDSS planner already
 * proves for its own domain.
 *
 * `TCtx` here is "whatever telemetry informs this planning pass" —
 * same reasoning `CdssBedContext`'s own doc comment gives for bundling
 * exactly what the rule needs, no more.
 */
export interface OpsRemediationContext {
  readonly events: readonly TelemetryEvent[];
}

/**
 * The one concrete, end-to-end rule implemented in this slice:
 * `SandboxTimeout` -> `ReprovisionSandbox`, one-for-one, using the
 * event's own `correlationId` as the sandbox to reprovision (see
 * `telemetry/opsTelemetryListener.ts` and
 * `SandboxTimeoutEvent`'s own doc comment in `@xhis/core` for why that
 * correlation holds).
 *
 * `HandlerException`/`CommitConflict` are deliberately *not* mapped to
 * any remediation instruction yet — both are domain-agnostic core
 * signals ("some proposal failed to execute" / "a commit lost a race"),
 * and this planner does not yet have enough context to know what,
 * if anything, an ops action should do about either. See
 * docs/XGUARD_INTEGRATION.md for why that's deferred rather than
 * guessed at here.
 */
export function createOpsPlanner(): RawPlanner<OpsRemediationContext> {
  return {
    async plan(
      _goal,
      context: OpsRemediationContext,
      proposedAt: string,
      _feedback: readonly string[],
    ): Promise<Result<RawPlanOutput, string>> {
      const instructions: unknown[] = [];

      for (const event of context.events) {
        switch (event.kind) {
          case 'SandboxTimeout':
            instructions.push({
              kind: 'ReprovisionSandbox',
              sandboxId: event.correlationId,
              requestedAt: proposedAt,
            });
            break;
          case 'HandlerException':
          case 'CommitConflict':
            // TODO: no remediation rule mapped yet -- see this
            // function's own doc comment.
            break;
        }
      }

      return ok({
        instructions,
        rationale: `ops remediation rule: recommending ${instructions.length} action(s) from ${context.events.length} telemetry event(s)`,
        // Repurposed, not misused -- same reasoning
        // `createCdssBedPlanner` documents for its own `modelVersion`/
        // `promptVersion`: this planner has no model and no prompt at
        // all.
        modelVersion: 'ops-remediation-rule-engine-v1',
        promptVersion: 'ops-remediation-ruleset-v1',
      });
    },
  };
}
