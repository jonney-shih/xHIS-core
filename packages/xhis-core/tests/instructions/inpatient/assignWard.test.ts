import { describe, expect, it } from 'vitest';
import { assignWardHandler } from '../../../src/instructions/inpatient/handlers/assignWard.js';
import { encounterId, isoTimestamp, staffId, wardAssignmentId } from '../../../src/instructions/inpatient/ids.js';
import type { InpatientContext } from '../../../src/instructions/inpatient/types.js';

const emptyContext: InpatientContext = { wardAssignments: {}, progressNotes: {} };

describe('assignWardHandler', () => {
  it('assigns a new ward and emits a WardAssigned effect', () => {
    const result = assignWardHandler(emptyContext, {
      kind: 'AssignWard',
      assignmentId: wardAssignmentId('assignment-1'),
      encounterId: encounterId('encounter-1'),
      ward: '5B',
      attendingStaffId: staffId('dr-lin'),
      assignedAt: isoTimestamp('2026-10-18T09:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.wardAssignments['assignment-1']).toEqual({
      assignmentId: 'assignment-1',
      encounterId: 'encounter-1',
      ward: '5B',
      attendingStaffId: 'dr-lin',
      status: 'active',
      assignedAt: '2026-10-18T09:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'WardAssigned', assignmentId: 'assignment-1', encounterId: 'encounter-1', ward: '5B', attendingStaffId: 'dr-lin', assignedAt: '2026-10-18T09:00:00.000Z' },
    ]);
  });

  it('rejects an assignment id that already exists', () => {
    const first = assignWardHandler(emptyContext, {
      kind: 'AssignWard',
      assignmentId: wardAssignmentId('assignment-1'),
      encounterId: encounterId('encounter-1'),
      ward: '5B',
      attendingStaffId: staffId('dr-lin'),
      assignedAt: isoTimestamp('2026-10-18T09:00:00.000Z'),
    });
    if (!first.ok) throw new Error('expected first assignment to succeed');

    const second = assignWardHandler(first.value.context, {
      kind: 'AssignWard',
      assignmentId: wardAssignmentId('assignment-1'),
      encounterId: encounterId('encounter-2'),
      ward: '6A',
      attendingStaffId: staffId('dr-wu'),
      assignedAt: isoTimestamp('2026-10-18T09:05:00.000Z'),
    });

    expect(second).toEqual({ ok: false, error: { kind: 'WardAssignmentAlreadyExists', assignmentId: 'assignment-1' } });
  });

  it('rejects a second active assignment for an encounter that already has one', () => {
    const first = assignWardHandler(emptyContext, {
      kind: 'AssignWard',
      assignmentId: wardAssignmentId('assignment-1'),
      encounterId: encounterId('encounter-1'),
      ward: '5B',
      attendingStaffId: staffId('dr-lin'),
      assignedAt: isoTimestamp('2026-10-18T09:00:00.000Z'),
    });
    if (!first.ok) throw new Error('expected first assignment to succeed');

    const second = assignWardHandler(first.value.context, {
      kind: 'AssignWard',
      assignmentId: wardAssignmentId('assignment-2'),
      encounterId: encounterId('encounter-1'),
      ward: '6A',
      attendingStaffId: staffId('dr-wu'),
      assignedAt: isoTimestamp('2026-10-18T09:05:00.000Z'),
    });

    expect(second).toEqual({ ok: false, error: { kind: 'EncounterAlreadyHasActiveWardAssignment', encounterId: 'encounter-1' } });
  });
});
