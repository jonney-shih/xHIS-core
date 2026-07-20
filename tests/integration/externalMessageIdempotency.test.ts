import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileMessageIdempotencyStore } from '../../src/integration/externalMessageIdempotency.js';

let dir: string;
let storeFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-message-idempotency-'));
  storeFile = join(dir, 'processed-messages.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('createFileMessageIdempotencyStore', () => {
  it('reports a message as not processed until it is explicitly marked', () => {
    const store = createFileMessageIdempotencyStore(storeFile);

    expect(store.hasProcessed('msg-1')).toBe(false);
    store.markProcessed('msg-1');
    expect(store.hasProcessed('msg-1')).toBe(true);
  });

  it('does not confuse unrelated message IDs with each other', () => {
    const store = createFileMessageIdempotencyStore(storeFile);

    store.markProcessed('msg-1');

    expect(store.hasProcessed('msg-2')).toBe(false);
  });

  it('recognizes a message as already processed from a freshly constructed store reading the same file — a restarted receiver process', () => {
    const first = createFileMessageIdempotencyStore(storeFile);
    first.markProcessed('msg-1');

    const second = createFileMessageIdempotencyStore(storeFile);

    expect(second.hasProcessed('msg-1')).toBe(true);
  });
});
