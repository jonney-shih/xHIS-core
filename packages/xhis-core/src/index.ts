/**
 * `@xhis/core`'s public export surface — the *only* seam any sibling
 * package in this workspace is ever allowed to import from. See
 * `CLAUDE.md`'s guardrails (the Deterministic Foundation/domain-split
 * boundary) and each sibling package's own `coreBoundary.guard.test.ts`
 * for the CI-enforced side of that rule: a deep import like
 * `@xhis/core/dist/agentic/shell/act.js` is exactly what this file
 * exists to make unnecessary, so it can be banned outright rather than
 * merely discouraged. This module intentionally names no specific
 * consumer — see `docs/` for how the first real sibling package
 * actually uses this surface.
 *
 * Deliberately not "everything under `src/`" — this repository's own
 * clinical domains (`instructions/bed`, `agentic/risk/lab`, ...) are
 * real, working examples of the *pattern* a new domain follows, not
 * reusable library code a new domain imports from. What a new,
 * non-clinical, operational domain actually needs to reuse is the
 * domain-*agnostic* machinery underneath every one of those examples:
 * the execution engine, the Result/outcome shapes, the risk-tier/
 * verifier/approval-policy primitives, the `ImperativeShell` seam, and
 * the telemetry hook. That is exactly what this file re-exports,
 * grouped the same way `src/` itself is grouped.
 */

// core/execution — the deterministic dispatch machinery every domain's
// own `engine.ts` is built from (see `instructions/bed/engine.ts` for
// the pattern).
export type { Kinded } from './core/execution/kinded.js';
export { err, flatMap, map, match, ok, type Result } from './core/execution/result.js';
export type { ExecutionOutcome } from './core/execution/outcome.js';
export type { Handler, HandlerRegistry } from './core/execution/handler.js';
export {
  createEngine,
  type HandlerExceptionTelemetryContext,
  type SequenceFailure,
} from './core/execution/engine.js';

// core — domain-agnostic primitives every instruction/handler/proposal
// in this codebase already threads explicitly instead of reading an
// ambient clock (see docs/ARCHITECTURE.md).
export { isoTimestamp, tick, type IsoTimestamp, type Tick } from './core/temporal.js';

// agentic/risk — the RiskTier ladder and the total-registry pattern a
// new domain's own risk classification is built from (see
// `agentic/risk/bed.ts`).
export { effectiveTier, type RiskTier, type RiskTierRegistry } from './agentic/risk/tiers.js';

// agentic/verification — Check: Verifier, the severity-merge combinator,
// and the one domain-agnostic rule factory every domain reuses as-is.
export type { Verifier, VerifyDecision } from './agentic/verification/verifier.js';
export { combineVerifiers, mergeDecisions } from './agentic/verification/combineVerifiers.js';
export { createRiskTierVerifier } from './agentic/verification/riskTierVerifier.js';

// agentic/validation — the untrusted-input-to-typed-instruction gate
// (see `agentic/validation/bed.ts`), plus the domain-agnostic shape
// guards every domain's own validators are built from.
export type {
  IndexedValidationIssues,
  InstructionValidator,
  InstructionValidatorRegistry,
} from './agentic/validation/validator.js';
export { validateInstruction, validateInstructions } from './agentic/validation/validator.js';
export { isIsoTimestamp, isNonEmptyString } from './agentic/validation/guards.js';

// agentic/planning — the proposal shape Check/Act consume, and the
// only sanctioned way to turn untrusted planner output into one.
export type { PlanningGoal, PlanProposal, Planner } from './agentic/planning/proposal.js';
export type { RawPlanner, RawPlanOutput } from './agentic/planning/toPlanProposal.js';
export { toPlanProposal } from './agentic/planning/toPlanProposal.js';

// agentic/identity — the IdentityProvider seam, the approval-policy
// type, and approval resolution (see `agentic/identity/bed.ts`).
export type { Identity, IdentityProvider } from './agentic/identity/identity.js';
export { createInMemoryIdentityProvider } from './agentic/identity/inMemoryIdentityProvider.js';
export type { ApprovalPolicy } from './agentic/identity/approvalPolicy.js';
export type { ApprovalRequest, ApprovalResolution } from './agentic/identity/resolveApproval.js';
export { resolveApproval } from './agentic/identity/resolveApproval.js';
export { resolveApprovalForProposal } from './agentic/identity/resolveApprovalForProposal.js';

// agentic/shell — the ImperativeShell seam, Act itself, the audit
// record/timeline shapes, and the in-memory shell every domain's own
// tests (and a new domain's first working slice) are built from.
export type { ImperativeShell } from './agentic/shell/shell.js';
export { act, type ActInput, type ActTelemetryTag } from './agentic/shell/act.js';
export type { AuditRecord, Approval, CommitOutcome } from './agentic/shell/auditRecord.js';
export { createInMemoryShell } from './agentic/shell/inMemoryShell.js';
export {
  mergeAuditTimelines,
  summarizeAgentAuditRecord,
  type AuditTimelineEntry,
} from './agentic/shell/auditTimeline.js';

// telemetry — additive, dependency-free operational signals (see
// `telemetry/hook.ts`'s own doc comment). `telemetry` is the shared,
// process-wide hook every `@xhis/core` failure path above emits
// through; `createTelemetryHook` is the dependency-injectable form for
// tests or for a caller that wants an independent hook instead.
export type {
  CommitConflictEvent,
  HandlerExceptionEvent,
  SandboxTimeoutEvent,
  TelemetryEvent,
} from './telemetry/types.js';
export { createTelemetryHook, telemetry, type TelemetryHook, type TelemetryListener } from './telemetry/hook.js';
