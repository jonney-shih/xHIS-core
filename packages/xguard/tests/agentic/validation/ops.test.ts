import { describe, expect, it } from 'vitest';
import { opsInstructionValidators } from '../../../src/agentic/validation/ops.js';

describe('ops instruction validators', () => {
  it('accepts a well-formed ReprovisionSandbox candidate', () => {
    const result = opsInstructionValidators.ReprovisionSandbox({
      kind: 'ReprovisionSandbox',
      sandboxId: 'sandbox-1',
      requestedAt: '2026-08-01T00:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: 'ReprovisionSandbox', sandboxId: 'sandbox-1', requestedAt: '2026-08-01T00:00:00.000Z' },
    });
  });

  it('rejects a ReprovisionSandbox candidate missing sandboxId', () => {
    const result = opsInstructionValidators.ReprovisionSandbox({
      kind: 'ReprovisionSandbox',
      requestedAt: '2026-08-01T00:00:00.000Z',
    });

    expect(result.ok).toBe(false);
  });

  it('accepts a well-formed CordonNode candidate', () => {
    const result = opsInstructionValidators.CordonNode({
      kind: 'CordonNode',
      nodeId: 'node-1',
      requestedAt: '2026-08-01T00:00:00.000Z',
    });

    expect(result.ok).toBe(true);
  });

  it('accepts a well-formed RestartContainer candidate', () => {
    const result = opsInstructionValidators.RestartContainer({
      kind: 'RestartContainer',
      containerId: 'container-1',
      requestedAt: '2026-08-01T00:00:00.000Z',
    });

    expect(result.ok).toBe(true);
  });

  it('accepts a well-formed ScaleDeployment candidate, rejecting a negative replica count', () => {
    const ok = opsInstructionValidators.ScaleDeployment({
      kind: 'ScaleDeployment',
      deploymentId: 'deployment-1',
      replicas: 3,
      requestedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(ok.ok).toBe(true);

    const bad = opsInstructionValidators.ScaleDeployment({
      kind: 'ScaleDeployment',
      deploymentId: 'deployment-1',
      replicas: -1,
      requestedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(bad.ok).toBe(false);
  });
});
