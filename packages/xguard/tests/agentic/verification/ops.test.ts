import type { PlanProposal } from '@xhis/core';
import { isoTimestamp } from '@xhis/core';
import { describe, expect, it } from 'vitest';
import { opsVerifier } from '../../../src/agentic/verification/ops.js';
import { deploymentId, nodeId, sandboxId } from '../../../src/instructions/ids.js';
import type { OpsInstruction } from '../../../src/instructions/types.js';

function proposalFor(instructions: readonly OpsInstruction[]): PlanProposal<OpsInstruction> {
  return {
    instructions,
    rationale: 'test',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('ops verifier', () => {
  it('accepts an auto-tier ReprovisionSandbox proposal outright', () => {
    const decision = opsVerifier.verify(
      proposalFor([
        {
          kind: 'ReprovisionSandbox',
          sandboxId: sandboxId('sandbox-1'),
          requestedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
        },
      ]),
    );

    expect(decision).toEqual({ kind: 'accept' });
  });

  it('requires human approval for a CordonNode proposal', () => {
    const decision = opsVerifier.verify(
      proposalFor([
        { kind: 'CordonNode', nodeId: nodeId('node-1'), requestedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
      ]),
    );

    expect(decision.kind).toBe('needs-human-approval');
  });

  it('requires human approval for a ScaleDeployment proposal', () => {
    const decision = opsVerifier.verify(
      proposalFor([
        {
          kind: 'ScaleDeployment',
          deploymentId: deploymentId('deployment-1'),
          replicas: 5,
          requestedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
        },
      ]),
    );

    expect(decision.kind).toBe('needs-human-approval');
  });
});
