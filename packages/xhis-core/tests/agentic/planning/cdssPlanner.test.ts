import { describe, expect, it } from 'vitest';
import { createCdssTriagePlanner } from '../../../src/agentic/planning/cdssPlanner.js';
import type { TriageSignal } from '../../../src/agentic/planning/cdssPlanner.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientContext } from '../../../src/instructions/patient/types.js';

const emptyPatientContext: PatientContext = { encounters: {} };

describe('createCdssTriagePlanner', () => {
  it('recommends admission for an emergent signal not yet admitted', async () => {
    const planner = createCdssTriagePlanner();
    const signal: TriageSignal = { patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), severity: 'emergent' };

    const result = await planner.plan(
      { description: 'triage sweep' },
      { patientContext: emptyPatientContext, signals: [signal] },
      '2026-07-20T00:00:00.000Z',
      [],
    );

    expect(result).toEqual({
      ok: true,
      value: {
        instructions: [
          { kind: 'AdmitPatient', patientId: 'patient-1', encounterId: 'encounter-1', admittedAt: '2026-07-20T00:00:00.000Z' },
        ],
        rationale: 'CDSS triage rule: recommending admission for 1 emergent signal(s) not yet admitted',
        modelVersion: 'cdss-triage-rule-engine-v1',
        promptVersion: 'triage-ruleset-v1',
      },
    });
  });

  it('ignores urgent and routine signals — only emergent triggers a recommendation', async () => {
    const planner = createCdssTriagePlanner();
    const signals: readonly TriageSignal[] = [
      { patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), severity: 'urgent' },
      { patientId: patientId('patient-2'), encounterId: encounterId('encounter-2'), severity: 'routine' },
    ];

    const result = await planner.plan({ description: 'triage sweep' }, { patientContext: emptyPatientContext, signals }, '2026-07-20T00:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  it('is idempotent: an emergent signal for an encounter that already exists produces no recommendation', async () => {
    const planner = createCdssTriagePlanner();
    const signal: TriageSignal = { patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), severity: 'emergent' };
    const alreadyAdmitted: PatientContext = {
      encounters: {
        'encounter-1': { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1'), status: 'admitted', admittedAt: isoTimestamp('2026-07-19T00:00:00.000Z') },
      },
    };

    const result = await planner.plan({ description: 'triage sweep' }, { patientContext: alreadyAdmitted, signals: [signal] }, '2026-07-20T00:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  it('ignores feedback — the rule is a pure function of context and signals, not of prior attempts', async () => {
    const planner = createCdssTriagePlanner();
    const signal: TriageSignal = { patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), severity: 'emergent' };

    const first = await planner.plan({ description: 'triage sweep' }, { patientContext: emptyPatientContext, signals: [signal] }, '2026-07-20T00:00:00.000Z', []);
    const second = await planner.plan(
      { description: 'triage sweep' },
      { patientContext: emptyPatientContext, signals: [signal] },
      '2026-07-20T00:00:00.000Z',
      ['some prior feedback that a deterministic rule has no way to act on'],
    );

    expect(first).toEqual(second);
  });
});
