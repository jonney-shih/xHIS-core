import { describe, expect, it } from 'vitest';
import { createStubPatientPlanner } from '../../../src/agentic/planning/stubPlanner.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientContext } from '../../../src/instructions/patient/types.js';

describe('createStubPatientPlanner', () => {
  it('always proposes the same fixed instructions, stamped with the given proposedAt', async () => {
    const admit = {
      kind: 'AdmitPatient' as const,
      patientId: patientId('patient-1'),
      encounterId: encounterId('encounter-1'),
      admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
    };
    const planner = createStubPatientPlanner([admit], 'fixed test proposal');
    const emptyContext: PatientContext = { encounters: {} };

    const proposal = await planner.plan({ description: 'anything' }, emptyContext, '2026-07-19T00:00:00.000Z');

    expect(proposal).toEqual({
      instructions: [admit],
      rationale: 'fixed test proposal',
      modelVersion: 'stub-v0',
      promptVersion: 'stub-v0',
      proposedAt: '2026-07-19T00:00:00.000Z',
    });
  });

  it('ignores the goal and context it is given', async () => {
    const planner = createStubPatientPlanner([], 'irrelevant to goal/context');
    const nonEmptyContext: PatientContext = {
      encounters: {
        'encounter-9': {
          encounterId: encounterId('encounter-9'),
          patientId: patientId('patient-9'),
          status: 'admitted',
          admittedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
        },
      },
    };

    const proposal = await planner.plan({ description: 'discharge everyone' }, nonEmptyContext, '2026-07-19T00:00:00.000Z');

    expect(proposal.instructions).toEqual([]);
  });
});
