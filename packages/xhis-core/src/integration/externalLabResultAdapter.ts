import type { IsoTimestamp, LabOrderId } from '../instructions/lab/ids.js';
import type { LabContext, LabEffect, LabError, LabInstruction } from '../instructions/lab/types.js';
import type { LabCommitter } from './outboxRelayLab.js';
import type { LabEngineLike } from './patientToLab.js';
import type { MessageIdempotencyStore } from './externalMessageIdempotency.js';

/**
 * A deliberately synthetic message shape — not real HL7v2/FHIR wire
 * format. Real protocol parsing is genuinely different, unglamorous
 * engineering with no architectural claim to test (see
 * docs/DETERMINISTIC_CORE_PATTERN.md's "external protocol integration"
 * entry); this exists only to carry the one field this module actually
 * tests: `messageControlId`, the external system's own dedup key — the
 * same role HL7's MSH-10 plays in a real interface.
 */
export interface ExternalLabResultMessage {
  readonly messageControlId: string;
  readonly orderId: LabOrderId;
  readonly result: string;
  readonly resultedAt: IsoTimestamp;
}

export type ExternalIngestOutcome =
  | { readonly kind: 'ingested'; readonly orderId: LabOrderId }
  | { readonly kind: 'ingestion-failed'; readonly orderId: LabOrderId; readonly error: LabError };

export interface ReactToExternalLabResultMessageResult {
  readonly context: LabContext;
  readonly outcome: ExternalIngestOutcome;
  readonly effects: readonly LabEffect[];
}

/**
 * Pure — what ingesting this one message would do to lab state, with
 * no idempotency check and no I/O. Deliberately unaware that the
 * message might be a duplicate; that's `ingestExternalLabResult`'s job,
 * layered on top exactly the way `outboxRelay.ts`'s reliable-delivery
 * concern is layered independently of `patientBedSaga.ts`'s all-or-
 * nothing concern elsewhere in this codebase — two composable concerns,
 * not one function doing both.
 */
export function reactToExternalLabResultMessage(
  labEngine: LabEngineLike,
  labContext: LabContext,
  message: ExternalLabResultMessage,
): ReactToExternalLabResultMessageResult {
  const instruction: LabInstruction = {
    kind: 'ReportLabResult',
    orderId: message.orderId,
    result: message.result,
    resultedAt: message.resultedAt,
  };

  const result = labEngine.execute(labContext, instruction);

  if (!result.ok) {
    return {
      context: labContext,
      outcome: { kind: 'ingestion-failed', orderId: message.orderId, error: result.error },
      effects: [],
    };
  }

  return {
    context: result.value.context,
    outcome: { kind: 'ingested', orderId: message.orderId },
    effects: result.value.effects,
  };
}

export type IngestOutcome = ExternalIngestOutcome | { readonly kind: 'duplicate'; readonly messageControlId: string };

export interface IngestExternalLabResultResult {
  readonly context: LabContext;
  readonly outcome: IngestOutcome;
}

/**
 * The actual idempotent-ingestion entry point — checks
 * `store.hasProcessed` *before* doing anything else, so a redelivered
 * message never even reaches lab state a second time. On a genuinely
 * new message, commits the resulting effect via `labCommitter`
 * *before* calling `store.markProcessed` — the same ordering discipline
 * `outboxRelay.ts` uses for its cursor: a crash between the two means
 * the message still looks unprocessed on redelivery and gets retried,
 * never silently skipped.
 *
 * That retry then runs straight into `reportLabResultHandler`'s own
 * `LabOrderNotPending` rejection (the order is already `resulted` from
 * the first, successful attempt) — a second, independent safety net,
 * not the only line of defense. `store`/`labCommitter` staying in sync
 * is the common case this function optimizes for; the domain's own
 * state-based check is what catches it if they're ever not — see
 * `tests/integration/externalLabResultAdapter.test.ts`'s
 * belt-and-suspenders test for the empirical proof.
 *
 * Reacts against `labCommitter.readLatest() ?? labContext`, not
 * `labContext` directly — the same fix `relayEffects` needed for the
 * identical reason: lab has other independent writers (the agentic
 * pipeline, `outboxRelayLab.ts`) into the same store, and a `labContext`
 * argument that predates one of their commits must not get blindly
 * built on top of and overwrite what they already committed. See
 * `docs/DETERMINISTIC_CORE_PATTERN.md`'s "Resolved: the outbox relay
 * re-validates against reality before each commit" for the sibling fix
 * this one mirrors.
 */
export function ingestExternalLabResult(
  store: MessageIdempotencyStore,
  labCommitter: LabCommitter,
  labEngine: LabEngineLike,
  labContext: LabContext,
  message: ExternalLabResultMessage,
): IngestExternalLabResultResult {
  if (store.hasProcessed(message.messageControlId)) {
    return { context: labContext, outcome: { kind: 'duplicate', messageControlId: message.messageControlId } };
  }

  const latest = labCommitter.readLatest() ?? labContext;
  const reaction = reactToExternalLabResultMessage(labEngine, latest, message);

  if (reaction.outcome.kind === 'ingestion-failed') {
    return { context: reaction.context, outcome: reaction.outcome };
  }

  labCommitter.commit(reaction.context, reaction.effects);
  store.markProcessed(message.messageControlId);

  return { context: reaction.context, outcome: reaction.outcome };
}
