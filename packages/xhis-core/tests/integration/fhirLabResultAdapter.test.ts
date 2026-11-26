import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ingestFhirDiagnosticReport,
  parseFhirDiagnosticReportAsLabResultMessage,
} from '../../src/integration/fhirLabResultAdapter.js';
import { createFileMessageIdempotencyStore } from '../../src/integration/externalMessageIdempotency.js';
import type { LabCommitter } from '../../src/integration/outboxRelayLab.js';
import { labEngine } from '../../src/instructions/lab/engine.js';
import { labOrderId, isoTimestamp } from '../../src/instructions/lab/ids.js';
import { encounterId } from '../../src/instructions/patient/ids.js';
import type { LabContext, LabEffect } from '../../src/instructions/lab/types.js';

let dir: string;
let storeFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-fhir-lab-result-'));
  storeFile = join(dir, 'processed-messages.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function validDiagnosticReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    resourceType: 'DiagnosticReport',
    status: 'final',
    identifier: [{ system: 'urn:hospital:lis', value: 'fhir-msg-1' }],
    basedOn: [{ reference: 'ServiceRequest/order-1' }],
    conclusion: 'WBC 7.2',
    effectiveDateTime: '2026-07-20T01:00:00.000Z',
    issued: '2026-07-20T01:05:00.000Z',
    ...overrides,
  };
}

const contextWithPendingOrder: LabContext = {
  orders: {
    'order-1': {
      orderId: labOrderId('order-1'),
      encounterId: encounterId('encounter-1'),
      testCode: 'CBC',
      status: 'ordered',
      orderedAt: isoTimestamp('2026-07-20T00:00:00.000Z'),
    },
  },
};

function recordingCommitter(): { committer: LabCommitter; commits: readonly (readonly LabEffect[])[] } {
  const commits: (readonly LabEffect[])[] = [];
  let latestContext: LabContext | undefined;
  return {
    committer: {
      commit: (context, effects) => {
        commits.push(effects);
        latestContext = context;
      },
      readLatest: () => latestContext,
    },
    commits,
  };
}

describe('parseFhirDiagnosticReportAsLabResultMessage', () => {
  it('parses a valid, finalized DiagnosticReport into an ExternalLabResultMessage', () => {
    const result = parseFhirDiagnosticReportAsLabResultMessage(validDiagnosticReport());

    expect(result).toEqual({
      ok: true,
      value: {
        messageControlId: 'fhir-msg-1',
        orderId: 'order-1',
        result: 'WBC 7.2',
        resultedAt: '2026-07-20T01:00:00.000Z',
      },
    });
  });

  it('prefers effectiveDateTime over issued when both are present', () => {
    const result = parseFhirDiagnosticReportAsLabResultMessage(validDiagnosticReport());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.resultedAt).toBe('2026-07-20T01:00:00.000Z');
  });

  it('falls back to issued when effectiveDateTime is absent', () => {
    const resource = validDiagnosticReport();
    delete (resource as { effectiveDateTime?: unknown }).effectiveDateTime;

    const result = parseFhirDiagnosticReportAsLabResultMessage(resource);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.resultedAt).toBe('2026-07-20T01:05:00.000Z');
  });

  it('rejects a non-object input', () => {
    expect(parseFhirDiagnosticReportAsLabResultMessage(null)).toEqual({ ok: false, error: { kind: 'NotAFhirResource' } });
    expect(parseFhirDiagnosticReportAsLabResultMessage('not a resource')).toEqual({
      ok: false,
      error: { kind: 'NotAFhirResource' },
    });
  });

  it('rejects a resource that is not a DiagnosticReport', () => {
    const result = parseFhirDiagnosticReportAsLabResultMessage(validDiagnosticReport({ resourceType: 'Observation' }));
    expect(result).toEqual({ ok: false, error: { kind: 'UnexpectedResourceType', resourceType: 'Observation' } });
  });

  it.each(['preliminary', 'registered', 'partial', 'cancelled', 'entered-in-error'])(
    'refuses a report with status %j rather than treating it as authoritative',
    (status) => {
      const result = parseFhirDiagnosticReportAsLabResultMessage(validDiagnosticReport({ status }));
      expect(result).toEqual({ ok: false, error: { kind: 'ReportNotFinalized', status } });
    },
  );

  it.each(['final', 'amended', 'corrected'])('accepts a report with status %j', (status) => {
    const result = parseFhirDiagnosticReportAsLabResultMessage(validDiagnosticReport({ status }));
    expect(result.ok).toBe(true);
  });

  it('rejects a report with no identifier at all', () => {
    const result = parseFhirDiagnosticReportAsLabResultMessage(validDiagnosticReport({ identifier: [] }));
    expect(result).toEqual({ ok: false, error: { kind: 'MissingIdentifier' } });
  });

  it('rejects a report with no basedOn reference at all', () => {
    const result = parseFhirDiagnosticReportAsLabResultMessage(validDiagnosticReport({ basedOn: [] }));
    expect(result).toEqual({ ok: false, error: { kind: 'MissingBasedOnReference' } });
  });

  it('rejects a basedOn reference that does not point at a ServiceRequest', () => {
    const result = parseFhirDiagnosticReportAsLabResultMessage(
      validDiagnosticReport({ basedOn: [{ reference: 'Observation/order-1' }] }),
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: 'UnsupportedBasedOnReferenceShape', reference: 'Observation/order-1' },
    });
  });

  it('rejects a basedOn reference with no "/" at all', () => {
    const result = parseFhirDiagnosticReportAsLabResultMessage(validDiagnosticReport({ basedOn: [{ reference: 'order-1' }] }));
    expect(result).toEqual({ ok: false, error: { kind: 'UnsupportedBasedOnReferenceShape', reference: 'order-1' } });
  });

  it('rejects a report with no conclusion text', () => {
    const result = parseFhirDiagnosticReportAsLabResultMessage(validDiagnosticReport({ conclusion: '' }));
    expect(result).toEqual({ ok: false, error: { kind: 'MissingConclusion' } });
  });

  it('rejects a report with neither effectiveDateTime nor issued', () => {
    const resource = validDiagnosticReport();
    delete (resource as { effectiveDateTime?: unknown }).effectiveDateTime;
    delete (resource as { issued?: unknown }).issued;

    const result = parseFhirDiagnosticReportAsLabResultMessage(resource);
    expect(result).toEqual({ ok: false, error: { kind: 'MissingResultTimestamp' } });
  });

  it('rejects an unparseable timestamp rather than silently accepting it', () => {
    const result = parseFhirDiagnosticReportAsLabResultMessage(
      validDiagnosticReport({ effectiveDateTime: 'not-a-date', issued: undefined }),
    );
    expect(result).toEqual({ ok: false, error: { kind: 'MalformedResultTimestamp', value: 'not-a-date' } });
  });
});

describe('ingestFhirDiagnosticReport', () => {
  it('parses and ingests a real FHIR DiagnosticReport end to end, committing the effect', async () => {
    const store = createFileMessageIdempotencyStore(storeFile);
    const { committer, commits } = recordingCommitter();

    const result = await ingestFhirDiagnosticReport(
      store,
      committer,
      labEngine,
      contextWithPendingOrder,
      validDiagnosticReport(),
    );

    expect(result.outcome).toEqual({ kind: 'ingested', orderId: 'order-1' });
    expect(result.context.orders['order-1']!.status).toBe('resulted');
    expect(commits).toHaveLength(1);
    expect(store.hasProcessed('fhir-msg-1')).toBe(true);
  });

  it('a parse failure never touches the idempotency store or lab state at all', async () => {
    const store = createFileMessageIdempotencyStore(storeFile);
    const { committer, commits } = recordingCommitter();

    const result = await ingestFhirDiagnosticReport(
      store,
      committer,
      labEngine,
      contextWithPendingOrder,
      validDiagnosticReport({ status: 'preliminary' }),
    );

    expect(result.outcome).toEqual({ kind: 'fhir-parse-failed', error: { kind: 'ReportNotFinalized', status: 'preliminary' } });
    expect(result.context).toBe(contextWithPendingOrder); // untouched, not just equal
    expect(commits).toHaveLength(0);
    expect(store.hasProcessed('fhir-msg-1')).toBe(false);
  });

  it('is idempotent against a redelivered, byte-identical FHIR resource, via the real identifier value', async () => {
    const store = createFileMessageIdempotencyStore(storeFile);
    const { committer, commits } = recordingCommitter();
    const resource = validDiagnosticReport();

    const first = await ingestFhirDiagnosticReport(store, committer, labEngine, contextWithPendingOrder, resource);
    expect(first.outcome).toEqual({ kind: 'ingested', orderId: 'order-1' });

    const second = await ingestFhirDiagnosticReport(store, committer, labEngine, first.context, resource);

    expect(second.outcome).toEqual({ kind: 'duplicate', messageControlId: 'fhir-msg-1' });
    expect(commits).toHaveLength(1);
  });

  it('a referenced lab order that does not exist surfaces as a domain-level ingestion failure, not a parse failure', async () => {
    const store = createFileMessageIdempotencyStore(storeFile);
    const { committer } = recordingCommitter();

    const result = await ingestFhirDiagnosticReport(
      store,
      committer,
      labEngine,
      { orders: {} },
      validDiagnosticReport({ basedOn: [{ reference: 'ServiceRequest/does-not-exist' }] }),
    );

    expect(result.outcome).toEqual({
      kind: 'ingestion-failed',
      orderId: 'does-not-exist',
      error: { kind: 'LabOrderNotFound', orderId: 'does-not-exist' },
    });
  });
});
