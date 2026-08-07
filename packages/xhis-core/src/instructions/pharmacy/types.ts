import type { EncounterId, IsoTimestamp, PrescriptionId } from './ids.js';

/**
 * A medication code is kept as a plain string, not a controlled
 * vocabulary (NDC/RxNorm or similar) — inventing a real code system
 * before there's a real requirement to validate against one would be
 * guessing, the same reasoning `LabOrderRecord.testCode` documents for
 * lab.
 */
export interface PrescriptionRecord {
  readonly prescriptionId: PrescriptionId;
  readonly encounterId: EncounterId;
  readonly medicationCode: string;
  readonly status: 'prescribed' | 'dispensed';
  readonly prescribedAt: IsoTimestamp;
  readonly dispensedAt?: IsoTimestamp;
}

/** Plain, JSON-serializable state — see `PatientContext`'s doc comment
 * for why that matters. */
export interface PharmacyContext {
  readonly prescriptions: Readonly<Record<string, PrescriptionRecord>>;
}

/**
 * Deliberately just two instructions, the same restraint
 * `BedInstruction` applies. Formulary/interaction checking, refills, and
 * partial/split dispensing are all real parts of a prescription's
 * lifecycle in a real pharmacy system, and all deliberately out of scope
 * for this first slice — they don't change the shape of the pattern, and
 * modeling them before there's a real consumer would be guessing.
 */
export type PharmacyInstruction =
  | {
      readonly kind: 'PrescribeMedication';
      readonly prescriptionId: PrescriptionId;
      readonly encounterId: EncounterId;
      readonly medicationCode: string;
      readonly prescribedAt: IsoTimestamp;
    }
  | {
      // No `encounterId` here, unlike `PrescribeMedication` — the
      // prescription being dispensed already has one on record (set by
      // `PrescribeMedication`), and asking the caller to repeat it would
      // just be a second, possibly stale copy of the same fact.
      // `prescriptionId` alone identifies which record to transition,
      // the same reasoning `ReleaseBed` and `ReportLabResult` already
      // apply.
      readonly kind: 'DispenseMedication';
      readonly prescriptionId: PrescriptionId;
      readonly dispensedAt: IsoTimestamp;
    };

export type PharmacyEffect =
  | {
      readonly kind: 'MedicationPrescribed';
      readonly prescriptionId: PrescriptionId;
      readonly encounterId: EncounterId;
      readonly medicationCode: string;
      readonly prescribedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'MedicationDispensed';
      readonly prescriptionId: PrescriptionId;
      readonly encounterId: EncounterId;
      readonly dispensedAt: IsoTimestamp;
    };

export type PharmacyError =
  | { readonly kind: 'PrescriptionAlreadyExists'; readonly prescriptionId: PrescriptionId }
  | { readonly kind: 'PrescriptionNotFound'; readonly prescriptionId: PrescriptionId }
  | { readonly kind: 'PrescriptionNotPending'; readonly prescriptionId: PrescriptionId };
