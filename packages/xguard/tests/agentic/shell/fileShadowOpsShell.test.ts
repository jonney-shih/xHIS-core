import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isoTimestamp, readAuditLog, readCommits, readLatestContext } from '@xhis/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileShadowOpsShell } from '../../../src/agentic/shell/fileShadowOpsShell.js';
import { sandboxId } from '../../../src/instructions/ids.js';
import type { OpsContext, OpsEffect } from '../../../src/instructions/types.js';

const requestedAt = isoTimestamp('2026-08-01T00:00:00.000Z');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-xguard-file-shadow-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function paths() {
  return { commitsFile: join(dir, 'commits.jsonl'), auditFile: join(dir, 'audit.jsonl') };
}

describe('createFileShadowOpsShell', () => {
  it('writes a committed batch to disk, readable back through @xhis/core’s own readCommits', () => {
    const shell = createFileShadowOpsShell(paths());
    const context: OpsContext = { sandboxes: { 'sandbox-1': { sandboxId: sandboxId('sandbox-1'), status: 'reprovisioning' } } };
    const effects: readonly OpsEffect[] = [{ kind: 'SandboxReprovisioned', sandboxId: sandboxId('sandbox-1'), requestedAt }];

    shell.commit(context, effects);

    expect(readCommits<OpsContext, OpsEffect>(paths().commitsFile)).toEqual([{ context, effects }]);
  });

  it('survives a simulated process restart — a fresh shell instance reads back the same latest context', () => {
    const shell = createFileShadowOpsShell(paths());
    const context: OpsContext = { sandboxes: { 'sandbox-1': { sandboxId: sandboxId('sandbox-1'), status: 'reprovisioning' } } };
    shell.commit(context, [{ kind: 'SandboxReprovisioned', sandboxId: sandboxId('sandbox-1'), requestedAt }]);

    // A brand-new shell instance, over the identical paths -- standing
    // in for a restarted process that never held the first shell's
    // in-memory state at all.
    const restarted = createFileShadowOpsShell(paths());
    expect(restarted.readLatest()).toEqual(context);
    expect(readLatestContext<OpsContext>(paths().commitsFile)).toEqual(context);
  });

  it('writes audit records to disk too, readable back through readAuditLog', () => {
    const shell = createFileShadowOpsShell(paths());
    shell.recordAudit({
      proposal: { instructions: [], rationale: 'x', modelVersion: 'v1', promptVersion: 'v1', proposedAt: requestedAt },
      decision: { kind: 'accept' },
      commitOutcome: 'committed',
      reasons: [],
      effects: [],
      recordedAt: requestedAt,
    });

    expect(readAuditLog(paths().auditFile)).toHaveLength(1);
  });

  it('throws rather than writing an effect that bypassed the harness contract, and nothing is written', () => {
    const shell = createFileShadowOpsShell(paths());
    const corrupted = { kind: 'DeleteEverything', requestedAt } as unknown as OpsEffect;

    expect(() => shell.commit({ sandboxes: {} }, [corrupted])).toThrow(/refused to record/);
    expect(readCommits(paths().commitsFile)).toEqual([]);
  });
});
