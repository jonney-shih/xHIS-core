import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ingestExternalLabResult,
  reactToExternalLabResultMessage,
} from '../../src/integration/externalLabResultAdapter.js';
import type { ExternalLabResultMessage } from '../../src/integration/externalLabResultAdapter.js';
import { createFileMessageIdempotencyStore } from '../../src/integration/externalMessageIdempotency.js';
import type { LabCommitter } from '../../src/integration/outboxRelayLab.js';
import { labEngine } from '../../src/instructions/lab/engine.js';
import { labOrderId, isoTimestamp } from '../../src/instructions/lab/ids.js';
import { encounterId } from '../../src/instructions/patient/ids.js';
import type { LabContext, LabEffect } from '../../src/instructions/lab/types.js';

let dir: string;
let storeFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-external-lab-result-'));
  storeFile = join(dir, 'processed-messages.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

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

const message: ExternalLabResultMessage = {
  messageControlId: 'msg-1',
  orderId: labOrderId('order-1'),
  result: 'WBC 7.2',
  resultedAt: isoTimestamp('2026-07-20T01:00:00.000Z'),
};

function recordingCommitter(): { committer: LabCommitter; commits: readonly (readonly LabEffect[])[] } {
  const commits: (readonly LabEffect[])[] = [];
  return { committer: { commit: (_context, effects) => commits.push(effects) }, commits };
}

describe('reactToExternalLabResultMessage', () => {
  it('reports the result and returns the effect, with no idempotency check at all', () => {
    const result = reactToExternalLabResultMessage(labEngine, contextWithPendingOrder, message);

    expect(result.outcome).toEqual({ kind: 'ingested', orderId: 'order-1' });
    expect(result.context.orders['order-1'].status).toBe('resulted');
    expect(result.effects).toEqual([
      { kind: 'LabResultReported', orderId: 'order-1', encounterId: 'encounter-1', result: 'WBC 7.2', resultedAt: '2026-07-20T01:00:00.000Z' },
    ]);
  });

  it('reports ingestion-failed, not a thrown error, for a message referencing an order that does not exist', () => {
    const result = reactToExternalLabResultMessage(labEngine, { orders: {} }, message);

    expect(result.outcome).toEqual({ kind: 'ingestion-failed', orderId: 'order-1', error: { kind: 'LabOrderNotFound', orderId: 'order-1' } });
    expect(result.effects).toEqual([]);
  });
});

describe('ingestExternalLabResult', () => {
  it('ingests a new message, committing the effect and marking the message processed', () => {
    const store = createFileMessageIdempotencyStore(storeFile);
    const { committer, commits } = recordingCommitter();

    const result = ingestExternalLabResult(store, committer, labEngine, contextWithPendingOrder, message);

    expect(result.outcome).toEqual({ kind: 'ingested', orderId: 'order-1' });
    expect(commits).toHaveLength(1);
    expect(store.hasProcessed('msg-1')).toBe(true);
  });

  it('is idempotent: redelivering the identical message is recognized as a duplicate before touching lab state again', () => {
    const store = createFileMessageIdempotencyStore(storeFile);
    const { committer, commits } = recordingCommitter();

    const first = ingestExternalLabResult(store, committer, labEngine, contextWithPendingOrder, message);
    expect(first.outcome).toEqual({ kind: 'ingested', orderId: 'order-1' });

    const second = ingestExternalLabResult(store, committer, labEngine, first.context, message);

    expect(second.outcome).toEqual({ kind: 'duplicate', messageControlId: 'msg-1' });
    expect(second.context).toBe(first.context); // never touched a second time, not just equal
    expect(commits).toHaveLength(1); // only the first call committed anything
  });

  it('recognizes the same message as a duplicate even from a freshly constructed store — a restarted receiver process', () => {
    const store = createFileMessageIdempotencyStore(storeFile);
    const { committer } = recordingCommitter();

    const first = ingestExternalLabResult(store, committer, labEngine, contextWithPendingOrder, message);

    const restartedStore = createFileMessageIdempotencyStore(storeFile);
    const second = ingestExternalLabResult(restartedStore, committer, labEngine, first.context, message);

    expect(second.outcome).toEqual({ kind: 'duplicate', messageControlId: 'msg-1' });
  });

  it('falls back to the domain\'s own duplicate-rejection if the idempotency store is ever behind what was actually committed', () => {
    // Simulates a crash between committing the effect and marking the
    // message processed: react and commit happen directly, bypassing
    // `ingestExternalLabResult` entirely, so `store.markProcessed` never
    // runs — exactly the state a real crash there would leave behind.
    const store = createFileMessageIdempotencyStore(storeFile);
    const { committer } = recordingCommitter();

    const reaction = reactToExternalLabResultMessage(labEngine, contextWithPendingOrder, message);
    expect(reaction.outcome.kind).toBe('ingested');
    committer.commit(reaction.context, reaction.effects);
    expect(store.hasProcessed('msg-1')).toBe(false); // the store's own record never landed

    // Redelivery: the store still says "not processed," so this tries
    // the domain operation again for real, rather than trusting the
    // (in this scenario, incorrect) store state.
    const redelivered = ingestExternalLabResult(store, committer, labEngine, reaction.context, message);

    expect(redelivered.outcome).toEqual({
      kind: 'ingestion-failed',
      orderId: 'order-1',
      error: { kind: 'LabOrderNotPending', orderId: 'order-1' },
    });
  });
});
