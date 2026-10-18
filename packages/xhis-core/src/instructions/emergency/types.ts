import type { EmergencyVisitId, EncounterId, IsoTimestamp, PatientId } from './ids.js';

/**
 * The twelfth domain — the emergency-department counterpart to
 * `outpatient`/`inpatient`, kept separate from both for the same
 * reason they're kept separate from `patient`: an ED visit is its own
 * real-world lifecycle (arrival → triage → disposition), not a
 * variant of a scheduled outpatient visit or an inpatient stay. A
 * visit may *become* an inpatient stay (see `DispositionPatient`'s own
 * doc comment) or an outpatient follow-up, but those are separate
 * domains' own concerns, not this one's.
 *
 * `EsiLevel` is the real Emergency Severity Index scale (1 =
 * resuscitation, most critical; 5 = least urgent) — not invented here,
 * and not validated against anything beyond "one of these five
 * integers" (the actual ESI *algorithm* — vital-sign thresholds,
 * resource-count prediction — is a clinical judgment call this domain
 * has no business encoding, the same restraint `LabOrderRecord.testCode`
 * applies to not inventing a LOINC-equivalent).
 *
 * Deliberately minimal for a first pass, the same restraint every
 * other domain's own doc comment applies: no re-triage (a condition
 * can change after arrival, a real ED need, deferred here), no
 * disposition reversal, no boarding-time tracking once dispositioned
 * `'admitted'`. Each is a real feature a production system would
 * need; none is required to prove this domain's one real invariant.
 */
export type EsiLevel = 1 | 2 | 3 | 4 | 5;

export interface EmergencyVisitRecord {
  readonly visitId: EmergencyVisitId;
  readonly encounterId: EncounterId;
  readonly patientId: PatientId;
  readonly chiefComplaint: string;
  readonly esiLevel?: EsiLevel;
  readonly status: 'registered' | 'triaged' | 'dispositioned';
  readonly disposition?: 'admitted' | 'discharged' | 'transferred' | 'left-without-being-seen';
  readonly registeredAt: IsoTimestamp;
  readonly triagedAt?: IsoTimestamp;
  readonly dispositionedAt?: IsoTimestamp;
}

/** Plain, JSON-serializable state — see `PatientContext`'s doc comment
 * for why that matters. */
export interface EmergencyContext {
  readonly visits: Readonly<Record<string, EmergencyVisitRecord>>;
}

export type EmergencyInstruction =
  | {
      readonly kind: 'RegisterEdVisit';
      readonly visitId: EmergencyVisitId;
      readonly encounterId: EncounterId;
      readonly patientId: PatientId;
      readonly chiefComplaint: string;
      readonly registeredAt: IsoTimestamp;
    }
  | { readonly kind: 'TriagePatient'; readonly visitId: EmergencyVisitId; readonly esiLevel: EsiLevel; readonly triagedAt: IsoTimestamp }
  | {
      readonly kind: 'DispositionPatient';
      readonly visitId: EmergencyVisitId;
      readonly disposition: 'admitted' | 'discharged' | 'transferred' | 'left-without-being-seen';
      readonly dispositionedAt: IsoTimestamp;
    };

export type EmergencyEffect =
  | {
      readonly kind: 'EdVisitRegistered';
      readonly visitId: EmergencyVisitId;
      readonly encounterId: EncounterId;
      readonly patientId: PatientId;
      readonly chiefComplaint: string;
      readonly registeredAt: IsoTimestamp;
    }
  | { readonly kind: 'PatientTriaged'; readonly visitId: EmergencyVisitId; readonly esiLevel: EsiLevel; readonly triagedAt: IsoTimestamp }
  | {
      readonly kind: 'PatientDispositioned';
      readonly visitId: EmergencyVisitId;
      readonly encounterId: EncounterId;
      readonly disposition: 'admitted' | 'discharged' | 'transferred' | 'left-without-being-seen';
      readonly dispositionedAt: IsoTimestamp;
    };

export type EmergencyError =
  | { readonly kind: 'EdVisitAlreadyExists'; readonly visitId: EmergencyVisitId }
  | { readonly kind: 'EdVisitNotFound'; readonly visitId: EmergencyVisitId }
  | { readonly kind: 'EdVisitAlreadyTriaged'; readonly visitId: EmergencyVisitId }
  | { readonly kind: 'EdVisitNotTriaged'; readonly visitId: EmergencyVisitId }
  | { readonly kind: 'EdVisitAlreadyDispositioned'; readonly visitId: EmergencyVisitId };
