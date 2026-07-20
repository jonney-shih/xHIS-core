import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';

let dir: string;
let cursorFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-outbox-cursor-'));
  cursorFile = join(dir, 'cursor.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('createFileOutboxCursor', () => {
  it('reads 0 when nothing has ever been recorded', () => {
    expect(createFileOutboxCursor(cursorFile).read()).toBe(0);
  });

  it('reads back the most recently advanced position', () => {
    const cursor = createFileOutboxCursor(cursorFile);

    cursor.advance(3);
    cursor.advance(7);

    expect(cursor.read()).toBe(7);
  });

  it('persists across separate cursor instances pointed at the same file', () => {
    createFileOutboxCursor(cursorFile).advance(5);

    // A fresh instance, as a restarted process would create — nothing
    // about the cursor's progress lives in memory.
    const restarted = createFileOutboxCursor(cursorFile);

    expect(restarted.read()).toBe(5);
  });

  it('creates parent directories that do not exist yet', () => {
    const nestedFile = join(dir, 'nested', 'deeper', 'cursor.jsonl');

    const cursor = createFileOutboxCursor(nestedFile);
    cursor.advance(1);

    expect(createFileOutboxCursor(nestedFile).read()).toBe(1);
  });
});
