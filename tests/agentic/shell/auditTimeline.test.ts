import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCdssTriagePlanner } from '../../../src/agentic/planning/cdssPlanner.js';
import type { TriageSignal } from '../../../src/agentic/planning/cdssPlanner.js';
import { planWithRetries } from '../../../src/agentic/planning/planWithRetries.js';
import { patientInstructionValidators } from '../../../src/agentic/validation/patient.js';
import { patientVerifier } from '../../../src/agentic/verification/patient.js';
import { patientRiskTiers } from '../../../src/agentic/risk/patient.js';
import { bedRiskTiers } from '../../../src/agentic/risk/bed.js';
import { EXAMPLE_patientApprovalPolicy } from '../../../src/agentic/identity/patient.js';
import { EXAMPLE_bedApprovalPolicy } from '../../../src/agentic/identity/bed.js';
import { createInMemoryIdentityProvider } from '../../../src/agentic/identity/inMemoryIdentityProvider.js';
import { resolveApprovalForProposal } from '../../../src/agentic/identity/resolveApprovalForProposal.js';
import { resolveActorForInstructions } from '../../../src/agentic/identity/resolveActorForInstructions.js';
import { act } from '../../../src/agentic/shell/act.js';
import { createFileShell, readAuditLog } from '../../../src/agentic/shell/fileShell.js';
import { mergeAuditTimelines, summarizeAgentAuditRecord, summarizeHumanAuditRecord } from '../../../src/agentic/shell/auditTimeline.js';
import { actHuman } from '../../../src/human/actHuman.js';
import type { HumanActionAuditRecord } from '../../../src/human/humanActionAuditRecord.js';
import type { AuditRecord } from '../../../src/agentic/shell/auditRecord.js';
import { bedEngine } from '../../../src/instructions/bed/engine.js';
import { patientEngine } from '../../../src/instructions/patient/engine.js';
import { bedId } from '../../../src/instructions/bed/ids.js';
import { encounterId, patientId } from '../../../src/instructions/patient/ids.js';
import { isoTimestamp } from '../../../src/core/temporal.js';
import type { BedContext, BedEffect, BedInstruction } from '../../../src/instructions/bed/types.js';
import type { PatientContext, PatientEffect, PatientInstruction } from '../../../src/instructions/patient/types.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-audit-timeline-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const identityProvider = createInMemoryIdentityProvider([
  { id: 'dr-lin', displayName: 'Dr. Lin', roles: ['physician'] },
  { id: 'coordinator-tan', displayName: 'Coordinator Tan', roles: ['bed-coordinator'] },
]);

/**
 * The exact two open questions "Event bus vs. federated subscription"
 * and `shell.ts`'s own doc comment both raise, checked against a real
 * scenario rather than left as an abstract "still open": one patient
 * encounter's story told across two domains (patient, bed) *and* both
 * paths (agent-sourced, human-sourced) — three separately written audit
 * files, none of which know the other two exist, merged into one
 * chronological read.
 */
describe('mergeAuditTimelines — a real, three-source, cross-domain, cross-path timeline', () => {
  it('reconstructs one encounter\'s story in chronological order, even though the underlying files were not written or read in that order', async () => {
    // 1) Agent path, patient domain: CDSS recommends admitting
    // encounter-1; a human approves it. Written to its own audit file.
    const patientAgentShell = createFileShell<PatientContext, PatientInstruction, PatientEffect>({
      commitsFile: join(dir, 'patient-agent-commits.jsonl'),
      auditFile: join(dir, 'patient-agent-audit.jsonl'),
    });

    const signal: TriageSignal = { patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), severity: 'emergent' };
    const planResult = await planWithRetries(
      createCdssTriagePlanner(),
      patientInstructionValidators,
      { description: 'triage sweep' },
      { patientContext: { encounters: {} }, signals: [signal] },
      '2026-07-29T08:00:00.000Z',
      1,
    );
    if (!planResult.ok) throw new Error('expected ok');
    const admitProposal = planResult.value;
    const doOutcome = patientEngine.executeSequence({ encounters: {} }, admitProposal.instructions);
    const decision = patientVerifier.verify(admitProposal);
    const approval = resolveApprovalForProposal(identityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, admitProposal, {
      approverId: 'dr-lin',
      approved: true,
      decidedAt: '2026-07-29T08:05:00.000Z',
    });
    if (approval.kind !== 'resolved') throw new Error('expected resolved');

    act(patientAgentShell, {
      proposal: admitProposal,
      doOutcome,
      decision,
      baselineContext: { encounters: {} },
      reexecute: (ctx) => patientEngine.executeSequence(ctx, admitProposal.instructions),
      approval: approval.approval,
      recordedAt: '2026-07-29T08:05:01.000Z', // admitted
    });

    // 2) Human path, bed domain: a bed coordinator directly assigns a
    // bed to encounter-1, later the same morning. A completely
    // different domain, a completely different audit shape, its own
    // file — written *after* step 3 below, on purpose, to prove the
    // merge is a real sort, not an artifact of write order.
    const twoAvailableBeds: BedContext = {
      beds: {
        'bed-1': { bedId: bedId('bed-1'), status: 'available' },
        'bed-2': { bedId: bedId('bed-2'), status: 'available' },
      },
    };
    const assign: BedInstruction = { kind: 'AssignBed', bedId: bedId('bed-1'), encounterId: encounterId('encounter-1'), assignedAt: isoTimestamp('2026-07-29T09:00:00.000Z') };
    const bedAuthorization = resolveActorForInstructions(identityProvider, bedRiskTiers, EXAMPLE_bedApprovalPolicy, [assign], {
      actorId: 'coordinator-tan',
      assertedAt: '2026-07-29T09:00:01.000Z',
    });
    if (bedAuthorization.kind !== 'resolved') throw new Error('expected resolved');

    // 3) Human path, patient domain: a physician directly discharges
    // encounter-1 that evening — written to disk *before* step 2 above,
    // even though it happened chronologically after it.
    const admittedContext: PatientContext = {
      encounters: { 'encounter-1': { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1'), status: 'admitted', admittedAt: isoTimestamp('2026-07-29T08:00:00.000Z') } },
    };
    const discharge: PatientInstruction = { kind: 'DischargePatient', encounterId: encounterId('encounter-1'), dischargedAt: isoTimestamp('2026-07-29T18:00:00.000Z') };
    const patientHumanAuthorization = resolveActorForInstructions(identityProvider, patientRiskTiers, EXAMPLE_patientApprovalPolicy, [discharge], {
      actorId: 'dr-lin',
      assertedAt: '2026-07-29T18:00:01.000Z',
    });
    if (patientHumanAuthorization.kind !== 'resolved') throw new Error('expected resolved');

    const patientHumanShell = createFileShell<PatientContext, PatientInstruction, PatientEffect, HumanActionAuditRecord<PatientInstruction, PatientEffect>>({
      commitsFile: join(dir, 'patient-human-commits.jsonl'),
      auditFile: join(dir, 'patient-human-audit.jsonl'),
    });
    actHuman(patientHumanShell, {
      instructions: [discharge],
      baselineContext: admittedContext,
      reexecute: (ctx) => patientEngine.executeSequence(ctx, [discharge]),
      authorization: patientHumanAuthorization,
      recordedAt: '2026-07-29T18:00:02.000Z', // written second, happened third
    });

    // Now, finally, the bed assignment is actually committed and
    // recorded — written last on disk, even though chronologically
    // (09:00) it happened between the 08:05 admission and the 18:00
    // discharge.
    const bedHumanShell = createFileShell<BedContext, BedInstruction, BedEffect, HumanActionAuditRecord<BedInstruction, BedEffect>>({
      commitsFile: join(dir, 'bed-human-commits.jsonl'),
      auditFile: join(dir, 'bed-human-audit.jsonl'),
    });
    actHuman(bedHumanShell, {
      instructions: [assign],
      baselineContext: twoAvailableBeds,
      reexecute: (ctx) => bedEngine.executeSequence(ctx, [assign]),
      authorization: bedAuthorization,
      recordedAt: '2026-07-29T09:00:02.000Z', // written last, happened second
    });

    // Read all three files back — none of them know the other two exist.
    const patientAgentAudit = readAuditLog<PatientInstruction, PatientEffect>(join(dir, 'patient-agent-audit.jsonl'));
    const patientHumanAudit = readAuditLog<PatientInstruction, PatientEffect, HumanActionAuditRecord<PatientInstruction, PatientEffect>>(
      join(dir, 'patient-human-audit.jsonl'),
    );
    const bedHumanAudit = readAuditLog<BedInstruction, BedEffect, HumanActionAuditRecord<BedInstruction, BedEffect>>(
      join(dir, 'bed-human-audit.jsonl'),
    );

    const timeline = mergeAuditTimelines(
      patientAgentAudit.map((record: AuditRecord<PatientInstruction, PatientEffect>) => summarizeAgentAuditRecord('patient/agent', record)),
      patientHumanAudit.map((record) => summarizeHumanAuditRecord('patient/human', record)),
      bedHumanAudit.map((record) => summarizeHumanAuditRecord('bed/human', record)),
    );

    // Chronological, not write-order: admitted (08:05) -> bed assigned
    // (09:00) -> discharged (18:00), even though the files were written
    // admission, then discharge, then bed assignment.
    expect(timeline.map((entry) => entry.source)).toEqual(['patient/agent', 'bed/human', 'patient/human']);
    expect(timeline.map((entry) => entry.recordedAt)).toEqual([
      '2026-07-29T08:05:01.000Z',
      '2026-07-29T09:00:02.000Z',
      '2026-07-29T18:00:02.000Z',
    ]);
    expect(timeline[0]!.summary).toContain('[agent] committed');
    expect(timeline[0]!.summary).toContain('approved by dr-lin');
    expect(timeline[1]!.summary).toContain('[human] committed');
    expect(timeline[1]!.summary).toContain('by coordinator-tan (bed-coordinator)');
    expect(timeline[2]!.summary).toContain('[human] committed');
    expect(timeline[2]!.summary).toContain('by dr-lin (physician)');
  });

  it('merges zero, one, or many sources without special-casing any of them', () => {
    expect(mergeAuditTimelines()).toEqual([]);
    expect(mergeAuditTimelines([{ source: 'a', recordedAt: isoTimestamp('2026-07-29T00:00:00.000Z'), summary: 'only entry' }])).toHaveLength(1);
  });
});
