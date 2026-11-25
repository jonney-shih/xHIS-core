import { err, ok, type Result } from '../core/execution/result.js';
import { isoTimestamp } from '../core/temporal.js';
import { labOrderId } from '../instructions/lab/ids.js';
import type { LabContext } from '../instructions/lab/types.js';
import type { ExternalLabResultMessage, IngestOutcome } from './externalLabResultAdapter.js';
import { ingestExternalLabResult } from './externalLabResultAdapter.js';
import type { LabEngineLike } from './patientToLab.js';
import type { LabCommitter } from './outboxRelayLab.js';
import type { MessageIdempotencyStore } from './externalMessageIdempotency.js';

/**
 * The real protocol-parsing work `docs/DETERMINISTIC_CORE_PATTERN.md`'s
 * "message-ID idempotency for external protocol integration" entry
 * named as explicitly, deliberately out of scope at the time:
 * "nothing about actually parsing ... FHIR resources ... into
 * `ExternalLabResultMessage`'s shape." `externalLabResultAdapter.ts`'s
 * `ingestExternalLabResult`/`reactToExternalLabResultMessage` are
 * untouched by this file — it only ever produces the same
 * `ExternalLabResultMessage` shape they already consume, from a real
 * FHIR R4 `DiagnosticReport` resource instead of a synthetic one. Same
 * zero-runtime-dependency discipline as the rest of `@xhis/core`: this
 * is plain JSON-shape reading, not a FHIR client library — see
 * `CLAUDE.md`'s 1st guardrail, which names this exact file's job
 * ("FHIR/HL7 ... real wire-format parsing ... belongs in this same
 * layer when it's needed").
 *
 * Deliberately narrow, not a general-purpose FHIR `DiagnosticReport`
 * reader — the specific, real shape read here:
 * - `identifier[0].value` -> `messageControlId`. A report's own
 *   business identifier, not its server-assigned `.id` (which is not
 *   guaranteed stable across systems) — the same dedup-key role HL7's
 *   MSH-10 plays, and FHIR's closest real equivalent.
 * - `basedOn[0].reference`, required to be the standard
 *   `"ServiceRequest/<id>"` shape -> `orderId`. A real sender might
 *   instead populate `basedOn[0].identifier` with no literal
 *   `reference` at all — not handled here, see "What this doesn't do."
 * - `conclusion` -> `result`. FHIR's more structured alternative —
 *   `result[].reference` pointing at separate `Observation`
 *   resources, each with its own coded `value[x]` — is not read here,
 *   see "What this doesn't do."
 * - `effectiveDateTime`, falling back to `issued` -> `resultedAt`: the
 *   clinically-relevant moment the observation was actually made, not
 *   the moment the report document itself was issued, when the
 *   (optional) former is present.
 * - `status` must be `final`, `amended`, or `corrected` — a
 *   `preliminary`/`registered`/`partial`/`cancelled`/
 *   `entered-in-error` report is refused, not silently ingested as if
 *   it were authoritative. A real clinical-safety check this parser
 *   exists to enforce, not incidental shape validation: FHIR's own
 *   spec models a report's maturity through exactly this field, and
 *   accepting a preliminary result as final would be a correctness
 *   bug this system could not detect any other way, since nothing
 *   downstream of `ExternalLabResultMessage` knows FHIR exists at all.
 *
 * What this doesn't do, each real, unglamorous, independently
 * addable engineering behind this same `Result`-returning seam without
 * changing its signature: no FHIR profile/terminology validation
 * (LOINC codes, value-set binding), no `Bundle` unwrapping (expects
 * one already-extracted `DiagnosticReport` resource, not a transaction
 * `Bundle` containing one), no `result[]`/`Observation` resolution, no
 * `basedOn[].identifier`-only reference shape, no HL7v2 segment
 * parsing at all (a separate protocol, not attempted here).
 */
export type FhirParseError =
  | { readonly kind: 'NotAFhirResource' }
  | { readonly kind: 'UnexpectedResourceType'; readonly resourceType: string }
  | { readonly kind: 'ReportNotFinalized'; readonly status: string }
  | { readonly kind: 'MissingIdentifier' }
  | { readonly kind: 'MissingBasedOnReference' }
  | { readonly kind: 'UnsupportedBasedOnReferenceShape'; readonly reference: string }
  | { readonly kind: 'MissingConclusion' }
  | { readonly kind: 'MissingResultTimestamp' }
  | { readonly kind: 'MalformedResultTimestamp'; readonly value: string };

const FINALIZED_REPORT_STATUSES = new Set(['final', 'amended', 'corrected']);

/**
 * Only the fields this parser actually reads from a FHIR R4
 * `DiagnosticReport` resource — every field is `unknown` rather than
 * typed to the real FHIR shape on purpose: this file makes no claim
 * about the rest of the resource, including fields a real sender is
 * free to also send, and validates each one narrowly at the point it's
 * read instead of trusting a type assertion.
 */
interface FhirDiagnosticReportShape {
  readonly resourceType?: unknown;
  readonly status?: unknown;
  readonly identifier?: unknown;
  readonly basedOn?: unknown;
  readonly conclusion?: unknown;
  readonly effectiveDateTime?: unknown;
  readonly issued?: unknown;
}

function firstIdentifierValue(identifier: unknown): string | undefined {
  if (!Array.isArray(identifier) || identifier.length === 0) {
    return undefined;
  }
  const value = (identifier[0] as { value?: unknown } | undefined)?.value;
  return typeof value === 'string' ? value : undefined;
}

function firstBasedOnReference(basedOn: unknown): string | undefined {
  if (!Array.isArray(basedOn) || basedOn.length === 0) {
    return undefined;
  }
  const reference = (basedOn[0] as { reference?: unknown } | undefined)?.reference;
  return typeof reference === 'string' ? reference : undefined;
}

export function parseFhirDiagnosticReportAsLabResultMessage(
  resource: unknown,
): Result<ExternalLabResultMessage, FhirParseError> {
  if (typeof resource !== 'object' || resource === null) {
    return err({ kind: 'NotAFhirResource' });
  }
  const report = resource as FhirDiagnosticReportShape;

  if (report.resourceType !== 'DiagnosticReport') {
    return err({
      kind: 'UnexpectedResourceType',
      resourceType: typeof report.resourceType === 'string' ? report.resourceType : 'unknown',
    });
  }

  const status = typeof report.status === 'string' ? report.status : undefined;
  if (status === undefined || !FINALIZED_REPORT_STATUSES.has(status)) {
    return err({ kind: 'ReportNotFinalized', status: status ?? 'unknown' });
  }

  const messageControlId = firstIdentifierValue(report.identifier);
  if (messageControlId === undefined) {
    return err({ kind: 'MissingIdentifier' });
  }

  const reference = firstBasedOnReference(report.basedOn);
  if (reference === undefined) {
    return err({ kind: 'MissingBasedOnReference' });
  }
  const [referenceType, referenceId] = reference.split('/');
  if (referenceType !== 'ServiceRequest' || !referenceId) {
    return err({ kind: 'UnsupportedBasedOnReferenceShape', reference });
  }

  const conclusion = typeof report.conclusion === 'string' ? report.conclusion : undefined;
  if (conclusion === undefined || conclusion.length === 0) {
    return err({ kind: 'MissingConclusion' });
  }

  const rawTimestamp =
    typeof report.effectiveDateTime === 'string'
      ? report.effectiveDateTime
      : typeof report.issued === 'string'
        ? report.issued
        : undefined;
  if (rawTimestamp === undefined) {
    return err({ kind: 'MissingResultTimestamp' });
  }
  if (Number.isNaN(Date.parse(rawTimestamp))) {
    return err({ kind: 'MalformedResultTimestamp', value: rawTimestamp });
  }

  return ok({
    messageControlId,
    orderId: labOrderId(referenceId),
    result: conclusion,
    resultedAt: isoTimestamp(rawTimestamp),
  });
}

export type FhirIngestOutcome = IngestOutcome | { readonly kind: 'fhir-parse-failed'; readonly error: FhirParseError };

export interface IngestFhirDiagnosticReportResult {
  readonly context: LabContext;
  readonly outcome: FhirIngestOutcome;
}

/**
 * Parses, then — only on success — delegates to
 * `ingestExternalLabResult` unchanged. A parse failure never reaches
 * the idempotency store or lab state at all: an unparseable resource
 * is not "processed and rejected," it was never a message this system
 * could act on in the first place, so nothing about it is recorded as
 * seen.
 */
export async function ingestFhirDiagnosticReport(
  store: MessageIdempotencyStore,
  labCommitter: LabCommitter,
  labEngine: LabEngineLike,
  labContext: LabContext,
  resource: unknown,
): Promise<IngestFhirDiagnosticReportResult> {
  const parsed = parseFhirDiagnosticReportAsLabResultMessage(resource);
  if (!parsed.ok) {
    return { context: labContext, outcome: { kind: 'fhir-parse-failed', error: parsed.error } };
  }

  const result = await ingestExternalLabResult(store, labCommitter, labEngine, labContext, parsed.value);
  return { context: result.context, outcome: result.outcome };
}
