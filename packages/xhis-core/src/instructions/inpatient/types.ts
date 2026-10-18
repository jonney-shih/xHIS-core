import type { EncounterId, IsoTimestamp, ProgressNoteId, StaffId, WardAssignmentId } from './ids.js';

/**
 * The tenth domain — ward-stay concerns `patient`'s admit/discharge
 * bookends and `bed`'s physical resource allocation deliberately don't
 * cover: which ward/service a stay is currently under, who the
 * attending of record is, and the rounding documentation produced
 * along the way. Kept separate from both for the same reason
 * `outpatient` was kept separate from `patient` — no renaming of
 * either existing domain, this is purely additive.
 *
 * `WardAssignmentRecord` is deliberately not `bed`'s own concept:
 * `AssignBed`/`ReleaseBed` is resource allocation (which physical bed
 * is occupied), while a ward assignment here is a *clinical*
 * accountability fact (which service/attending is responsible for this
 * stay) — the two usually change together but are owned by different
 * bounded contexts, the same separation `patient`/`bed` already model
 * for "the encounter exists" versus "a bed holds it."
 *
 * Deliberately minimal for a first pass, the same restraint
 * `outpatient/types.ts` applies: no way to amend a draft progress
 * note, no way to correct a wrong `TransferWard` other than another
 * transfer, no linkage back to `patient`'s own `DischargePatient` (a
 * cross-domain gate that instruction would need is a separate,
 * larger design question, not assumed here). Each is a real feature a
 * production system would need; none is required to prove this
 * domain's one real invariant.
 */
export interface WardAssignmentRecord {
  readonly assignmentId: WardAssignmentId;
  readonly encounterId: EncounterId;
  readonly ward: string;
  readonly attendingStaffId: StaffId;
  readonly status: 'active' | 'ended';
  readonly assignedAt: IsoTimestamp;
  readonly endedAt?: IsoTimestamp;
}

/**
 * Linked to a specific `WardAssignmentRecord`, not just an `encounterId`
 * — deliberately finer-grained than `outpatient`'s `SoapNoteRecord`
 * (which only needs to link to one encounter, since an outpatient visit
 * has exactly one "stay" to document). An inpatient stay can span
 * several ward assignments over time, and `transferWardHandler`'s own
 * gating invariant (see below) specifically needs to ask "does *this*
 * assignment have a finalized note," not "has this encounter ever had
 * one" — the latter would let a single note written on day one silently
 * authorize every transfer for the rest of a multi-week stay.
 */
export interface ProgressNoteRecord {
  readonly noteId: ProgressNoteId;
  readonly assignmentId: WardAssignmentId;
  readonly authorStaffId: StaffId;
  readonly subjective: string;
  readonly objective: string;
  readonly assessment: string;
  readonly plan: string;
  readonly status: 'draft' | 'finalized';
  readonly recordedAt: IsoTimestamp;
  readonly finalizedAt?: IsoTimestamp;
}

/** Plain, JSON-serializable state — see `PatientContext`'s doc comment
 * for why that matters. */
export interface InpatientContext {
  readonly wardAssignments: Readonly<Record<string, WardAssignmentRecord>>;
  readonly progressNotes: Readonly<Record<string, ProgressNoteRecord>>;
}

export type InpatientInstruction =
  | {
      readonly kind: 'AssignWard';
      readonly assignmentId: WardAssignmentId;
      readonly encounterId: EncounterId;
      readonly ward: string;
      readonly attendingStaffId: StaffId;
      readonly assignedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'TransferWard';
      readonly newAssignmentId: WardAssignmentId;
      readonly encounterId: EncounterId;
      readonly ward: string;
      readonly attendingStaffId: StaffId;
      readonly transferredAt: IsoTimestamp;
    }
  | {
      readonly kind: 'RecordProgressNote';
      readonly noteId: ProgressNoteId;
      readonly assignmentId: WardAssignmentId;
      readonly authorStaffId: StaffId;
      readonly subjective: string;
      readonly objective: string;
      readonly assessment: string;
      readonly plan: string;
      readonly recordedAt: IsoTimestamp;
    }
  | { readonly kind: 'FinalizeProgressNote'; readonly noteId: ProgressNoteId; readonly finalizedAt: IsoTimestamp };

export type InpatientEffect =
  | {
      readonly kind: 'WardAssigned';
      readonly assignmentId: WardAssignmentId;
      readonly encounterId: EncounterId;
      readonly ward: string;
      readonly attendingStaffId: StaffId;
      readonly assignedAt: IsoTimestamp;
    }
  | { readonly kind: 'WardAssignmentEnded'; readonly assignmentId: WardAssignmentId; readonly encounterId: EncounterId; readonly endedAt: IsoTimestamp }
  | { readonly kind: 'ProgressNoteRecorded'; readonly noteId: ProgressNoteId; readonly assignmentId: WardAssignmentId; readonly recordedAt: IsoTimestamp }
  | { readonly kind: 'ProgressNoteFinalized'; readonly noteId: ProgressNoteId; readonly assignmentId: WardAssignmentId; readonly finalizedAt: IsoTimestamp };

export type InpatientError =
  | { readonly kind: 'WardAssignmentAlreadyExists'; readonly assignmentId: WardAssignmentId }
  | { readonly kind: 'EncounterAlreadyHasActiveWardAssignment'; readonly encounterId: EncounterId }
  | { readonly kind: 'EncounterHasNoActiveWardAssignment'; readonly encounterId: EncounterId }
  | { readonly kind: 'NoFinalizedProgressNoteForCurrentAssignment'; readonly assignmentId: WardAssignmentId }
  | { readonly kind: 'WardAssignmentNotFound'; readonly assignmentId: WardAssignmentId }
  | { readonly kind: 'WardAssignmentNotActive'; readonly assignmentId: WardAssignmentId }
  | { readonly kind: 'ProgressNoteAlreadyExists'; readonly noteId: ProgressNoteId }
  | { readonly kind: 'ProgressNoteNotFound'; readonly noteId: ProgressNoteId }
  | { readonly kind: 'ProgressNoteAlreadyFinalized'; readonly noteId: ProgressNoteId };
