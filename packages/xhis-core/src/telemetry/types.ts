import type { IsoTimestamp } from '../core/temporal.js';

/**
 * Operational telemetry — deliberately a *separate* discriminated union
 * from `agentic/shell/auditRecord.ts`'s `AuditRecord`, not a repurposing
 * of it. An `AuditRecord` is the non-repudiable record of one Act
 * decision on one clinical/business proposal; these events are signals
 * about the *running system itself* (a sandbox that stopped responding,
 * a handler that crashed, two commits racing) meant for an operational
 * consumer — a future sibling package built for self-healing/
 * observability, or any other such listener — not for a clinical audit
 * trail. Same "`kind` stays a literal string per variant, never widened"
 * discipline every other closed union in this codebase already follows
 * (see `core/execution/kinded.ts`).
 *
 * `domain` is a free-form string, not a closed union of this repo's own
 * clinical domain names — this module lives in the domain-agnostic core
 * (see `CLAUDE.md`'s guardrails) and must stay usable by any future
 * domain, including a non-clinical, operational one, without ever
 * needing to change shape. Same reasoning
 * `agentic/identity/identity.ts`'s `Identity.roles` doc comment gives for
 * staying a free-form string set instead of inventing a permission
 * taxonomy ahead of a real need.
 *
 * `correlationId` is likewise a plain string, not a branded ID type —
 * different domains and different event kinds correlate to different
 * things (an instruction, a proposal, a sandbox), and this module has no
 * way to know which one applies to who is emitting.
 *
 * `recordedAt` is caller-supplied, never read from an ambient clock —
 * the identical determinism discipline every handler and `act()` caller
 * in this codebase already follows (see docs/ARCHITECTURE.md and
 * `determinism.guard.test.ts`). A telemetry event describes something
 * that already happened at a moment its emitter already knows; it must
 * not become a second, hidden source of ambient-time dependence inside
 * `core/execution` or `agentic/shell`, which is why `hook.ts` never
 * calls a clock either.
 */
export interface SandboxTimeoutEvent {
  readonly kind: 'SandboxTimeout';
  readonly domain: string;
  readonly correlationId: string;
  readonly recordedAt: IsoTimestamp;
  /** How long the sandbox had been unresponsive when the timeout was
   * declared, in milliseconds — a plain caller-supplied duration, not a
   * clock reading. */
  readonly unresponsiveForMs: number;
}

export interface HandlerExceptionEvent {
  readonly kind: 'HandlerException';
  readonly domain: string;
  readonly correlationId: string;
  readonly recordedAt: IsoTimestamp;
  /** A human-readable description of what was thrown/failed. Never the
   * raw `Error` object itself — this event may cross a process/transport
   * boundary to a listener that has no business deserializing arbitrary
   * exception instances. */
  readonly message: string;
}

export interface CommitConflictEvent {
  readonly kind: 'CommitConflict';
  readonly domain: string;
  readonly correlationId: string;
  readonly recordedAt: IsoTimestamp;
  /** Why the fresh, commit-time re-check failed — see `act.ts`'s
   * `'stale'` `CommitOutcome` doc comment for the race this reports. */
  readonly reasons: readonly string[];
}

export type TelemetryEvent = SandboxTimeoutEvent | HandlerExceptionEvent | CommitConflictEvent;
