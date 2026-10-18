import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { EmergencyContext, EmergencyEffect, EmergencyError, EmergencyInstruction } from '../types.js';

type DispositionPatient = Extract<EmergencyInstruction, { kind: 'DispositionPatient' }>;

/**
 * The one real invariant this domain exists to prove: a visit cannot
 * be dispositioned — sent home, admitted, transferred, or marked left-
 * without-being-seen — until it has actually been triaged. Checked
 * directly against the visit's own `status`, not a separate flag: a
 * visit that is still `'registered'` rejects with `EdVisitNotTriaged`.
 * This is the real, distinguishing safety rule of emergency-department
 * workflow — every patient who presents gets at least a triage
 * assessment, no exceptions, even one who ends up leaving quickly.
 *
 * A `disposition` of `'admitted'` is a natural future outbox-relay
 * target into `patient`'s own `AdmitPatient` and `inpatient`'s own
 * `AssignWard` — the identical shape `outpatient`'s `CpoeOrderPlaced`
 * already relays into `lab`/`imaging`/`pharmacy` (see
 * `integration/outpatientToLab.ts` and its siblings) — but that relay
 * is deliberately not built here, the same "make it possible, not yet
 * real" restraint this codebase applies consistently (see
 * docs/DETERMINISTIC_CORE_PATTERN.md's "Resolved: ImperativeShell and
 * act() become async-capable" for the canonical instance of that
 * restraint). `PatientDispositioned` already carries `encounterId`
 * for exactly that future relay's sake, the same reason
 * `CpoeOrderPlaced` carries its own `encounterId` rather than making a
 * future relay look it up.
 */
export const dispositionPatientHandler: Handler<EmergencyContext, DispositionPatient, EmergencyEffect, EmergencyError> = (
  ctx,
  instruction,
) => {
  const visit = ctx.visits[instruction.visitId];
  if (!visit) {
    return err({ kind: 'EdVisitNotFound', visitId: instruction.visitId });
  }
  if (visit.status === 'registered') {
    return err({ kind: 'EdVisitNotTriaged', visitId: instruction.visitId });
  }
  if (visit.status === 'dispositioned') {
    return err({ kind: 'EdVisitAlreadyDispositioned', visitId: instruction.visitId });
  }

  const context: EmergencyContext = {
    visits: {
      ...ctx.visits,
      [instruction.visitId]: {
        ...visit,
        status: 'dispositioned',
        disposition: instruction.disposition,
        dispositionedAt: instruction.dispositionedAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'PatientDispositioned',
        visitId: instruction.visitId,
        encounterId: visit.encounterId,
        disposition: instruction.disposition,
        dispositionedAt: instruction.dispositionedAt,
      },
    ],
  });
};
