import type { CpoeOrderId, EncounterId, IsoTimestamp, PatientId, SoapNoteId, StaffId } from './ids.js';

/**
 * The ninth domain — the ambulatory counterpart to `patient`'s
 * admit/discharge lifecycle, deliberately kept separate from it rather
 * than added as new `PatientInstruction` variants: an outpatient visit
 * has no ward bed, no admission in the MOHW/legal sense `patient`'s own
 * domain carries, and introduces two kinds of state (`patient`'s own
 * doesn't) with a real gating relationship between them — the same
 * reason `nursing` split credential/role state out as its own domain
 * instead of folding it into an existing one.
 *
 * Deliberately minimal for a first pass, the same restraint `nursing`'s
 * own doc comment applies to not having a `RevokeRoleGrant`: no way to
 * amend a draft SOAP note, no way to cancel a placed CPOE order, no way
 * to reopen a completed encounter. Each is a real feature a production
 * system would need; none is required to prove the one invariant this
 * domain actually exists to test — that an encounter cannot be closed
 * out without a finalized clinical note backing it (see
 * `completeEncounterHandler`) — and adding them now would be scope
 * beyond that.
 */
export interface OutpatientEncounterRecord {
  readonly encounterId: EncounterId;
  readonly patientId: PatientId;
  readonly status: 'checked-in' | 'completed';
  readonly checkedInAt: IsoTimestamp;
  readonly completedAt?: IsoTimestamp;
}

/**
 * `status` tracks SOAP/CPOE's own real-world distinction between a note
 * being drafted and being finalized — a finalized note is part of the
 * legal medical record (MOHW record-completeness weight, the same
 * reasoning `patient`'s own `DischargePatient` carries); a draft is not
 * yet authoritative and, by design here, cannot gate `completeEncounterHandler`.
 */
export interface SoapNoteRecord {
  readonly noteId: SoapNoteId;
  readonly encounterId: EncounterId;
  readonly authorStaffId: StaffId;
  readonly subjective: string;
  readonly objective: string;
  readonly assessment: string;
  readonly plan: string;
  readonly status: 'draft' | 'finalized';
  readonly recordedAt: IsoTimestamp;
  readonly finalizedAt?: IsoTimestamp;
}

/**
 * Deliberately shaped to match the exact field each target domain's own
 * order-placing instruction already uses (`lab`'s `testCode`,
 * `imaging`'s `modality`, `pharmacy`'s `medicationCode`) — not because
 * this domain relays into them yet (it doesn't; see
 * `placeCpoeOrderHandler`'s own doc comment), but so that a future
 * outbox relay (the same pattern `integration/outboxRelayLab.ts`/
 * `outboxRelayImaging.ts` already establish) can translate a committed
 * `CpoeOrderPlaced` effect directly into that domain's own instruction
 * without a second, drifting definition of what a lab/imaging/pharmacy
 * order actually needs.
 */
export type CpoeOrderDetail =
  | { readonly orderType: 'lab'; readonly testCode: string }
  | { readonly orderType: 'imaging'; readonly modality: string }
  | { readonly orderType: 'pharmacy'; readonly medicationCode: string };

export interface CpoeOrderRecord {
  readonly orderId: CpoeOrderId;
  readonly encounterId: EncounterId;
  readonly detail: CpoeOrderDetail;
  readonly placedAt: IsoTimestamp;
}

/** Plain, JSON-serializable state — see `PatientContext`'s doc comment
 * for why that matters. */
export interface OutpatientContext {
  readonly encounters: Readonly<Record<string, OutpatientEncounterRecord>>;
  readonly soapNotes: Readonly<Record<string, SoapNoteRecord>>;
  readonly cpoeOrders: Readonly<Record<string, CpoeOrderRecord>>;
}

export type OutpatientInstruction =
  | { readonly kind: 'CheckInPatient'; readonly encounterId: EncounterId; readonly patientId: PatientId; readonly checkedInAt: IsoTimestamp }
  | {
      readonly kind: 'RecordSoapNote';
      readonly noteId: SoapNoteId;
      readonly encounterId: EncounterId;
      readonly authorStaffId: StaffId;
      readonly subjective: string;
      readonly objective: string;
      readonly assessment: string;
      readonly plan: string;
      readonly recordedAt: IsoTimestamp;
    }
  | { readonly kind: 'FinalizeSoapNote'; readonly noteId: SoapNoteId; readonly finalizedAt: IsoTimestamp }
  | {
      readonly kind: 'PlaceCpoeOrder';
      readonly orderId: CpoeOrderId;
      readonly encounterId: EncounterId;
      readonly detail: CpoeOrderDetail;
      readonly placedAt: IsoTimestamp;
    }
  | { readonly kind: 'CompleteEncounter'; readonly encounterId: EncounterId; readonly completedAt: IsoTimestamp };

export type OutpatientEffect =
  | { readonly kind: 'PatientCheckedIn'; readonly encounterId: EncounterId; readonly patientId: PatientId; readonly checkedInAt: IsoTimestamp }
  | { readonly kind: 'SoapNoteRecorded'; readonly noteId: SoapNoteId; readonly encounterId: EncounterId; readonly recordedAt: IsoTimestamp }
  | { readonly kind: 'SoapNoteFinalized'; readonly noteId: SoapNoteId; readonly encounterId: EncounterId; readonly finalizedAt: IsoTimestamp }
  | {
      readonly kind: 'CpoeOrderPlaced';
      readonly orderId: CpoeOrderId;
      readonly encounterId: EncounterId;
      readonly detail: CpoeOrderDetail;
      readonly placedAt: IsoTimestamp;
    }
  | { readonly kind: 'EncounterCompleted'; readonly encounterId: EncounterId; readonly completedAt: IsoTimestamp };

export type OutpatientError =
  | { readonly kind: 'EncounterAlreadyExists'; readonly encounterId: EncounterId }
  | { readonly kind: 'EncounterNotFound'; readonly encounterId: EncounterId }
  | { readonly kind: 'EncounterNotCheckedIn'; readonly encounterId: EncounterId }
  | { readonly kind: 'SoapNoteAlreadyExists'; readonly noteId: SoapNoteId }
  | { readonly kind: 'SoapNoteNotFound'; readonly noteId: SoapNoteId }
  | { readonly kind: 'SoapNoteAlreadyFinalized'; readonly noteId: SoapNoteId }
  | { readonly kind: 'CpoeOrderAlreadyExists'; readonly orderId: CpoeOrderId }
  | { readonly kind: 'NoFinalizedSoapNote'; readonly encounterId: EncounterId };
