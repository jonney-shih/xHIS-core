import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileProposalLog } from '../../../src/agentic/verification/proposalLog.js';
import { tick } from '../../../src/core/temporal.js';
import { encounterId, isoTimestamp, patientId } from '../../../src/instructions/patient/ids.js';
import type { PatientInstruction } from '../../../src/instructions/patient/types.js';
import type { PlanProposal } from '../../../src/agentic/planning/proposal.js';

let dir: string;
let logFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-proposal-log-'));
  logFile = join(dir, 'proposals.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function proposalFor(patientNumber: number): PlanProposal<PatientInstruction> {
  return {
    instructions: [
      {
        kind: 'AdmitPatient',
        patientId: patientId(`patient-${patientNumber}`),
        encounterId: encounterId(`encounter-${patientNumber}`),
        admittedAt: isoTimestamp('2026-07-28T00:00:00.000Z'),
      },
    ],
    rationale: 'test proposal',
    modelVersion: 'stub-v0',
    promptVersion: 'stub-v0',
    proposedAt: '2026-07-28T00:00:00.000Z',
  };
}

describe('createFileProposalLog', () => {
  it('assigns each appended proposal a distinct, increasing tick and a distinct proposalId', () => {
    const log = createFileProposalLog<PatientInstruction>(logFile);

    const firstId = log.append(proposalFor(1));
    const secondId = log.append(proposalFor(2));

    expect(firstId).not.toBe(secondId);

    const all = log.readSince(tick(0));
    expect(all).toHaveLength(2);
    expect(all[0]!.loggedAtTick).toBe(0);
    expect(all[1]!.loggedAtTick).toBe(1);
    expect(all[0]!.proposalId).toBe(firstId);
    expect(all[1]!.proposalId).toBe(secondId);
  });

  it('readSince is absolute-indexed: the first entry returned corresponds to fromTick itself', () => {
    const log = createFileProposalLog<PatientInstruction>(logFile);
    log.append(proposalFor(1));
    log.append(proposalFor(2));
    log.append(proposalFor(3));

    const sinceOne = log.readSince(tick(1));

    expect(sinceOne).toHaveLength(2);
    expect(sinceOne[0]!.loggedAtTick).toBe(1);
    expect(sinceOne[0]!.proposal.instructions[0]).toMatchObject({ encounterId: 'encounter-2' });
  });

  it('persists across a fresh createFileProposalLog instance pointed at the same file', () => {
    createFileProposalLog<PatientInstruction>(logFile).append(proposalFor(1));

    const reopened = createFileProposalLog<PatientInstruction>(logFile);
    reopened.append(proposalFor(2));

    const all = reopened.readSince(tick(0));
    expect(all).toHaveLength(2);
    expect(all[1]!.loggedAtTick).toBe(1);
  });
});
