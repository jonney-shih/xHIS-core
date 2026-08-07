import type { BedId } from './ids.js';
import type { EncounterId, IsoTimestamp } from './ids.js';

/**
 * Beds are physical assets that exist independently of any instruction —
 * unlike an `EncounterRecord`, nothing here ever *creates* a `BedRecord`.
 * A bed's presence in `BedContext.beds` is assumed to come from wherever
 * facilities/asset provisioning happens (out of scope here, same as the
 * imperative shell is out of scope for the patient domain); `AssignBed`/
 * `ReleaseBed` only ever transition an *existing* record. Assigning or
 * releasing a `bedId` this context has never heard of is `BedNotFound`,
 * not a chance to conjure the bed into existence.
 */
export interface BedRecord {
  readonly bedId: BedId;
  readonly status: 'available' | 'occupied';
  readonly encounterId?: EncounterId;
  readonly assignedAt?: IsoTimestamp;
}

/** Plain, JSON-serializable state — see `PatientContext`'s doc comment
 * for why that matters. */
export interface BedContext {
  readonly beds: Readonly<Record<string, BedRecord>>;
}

/**
 * Deliberately just two instructions, the same restraint
 * docs/ARCHITECTURE.md applies to the patient domain's proof-of-concept
 * pair. Bed cleaning/turnover, reservations ahead of an actual admission,
 * and out-of-service (maintenance) states are all real parts of a bed's
 * lifecycle in a real hospital, and all deliberately out of scope for
 * this first slice — they don't change the shape of the pattern, and
 * modeling them before there's a real consumer would be guessing.
 */
export type BedInstruction =
  | {
      readonly kind: 'AssignBed';
      readonly bedId: BedId;
      readonly encounterId: EncounterId;
      readonly assignedAt: IsoTimestamp;
    }
  | {
      // No `encounterId` here, unlike `AssignBed` — the bed being
      // released already has one on record (set by `AssignBed`), and
      // asking the caller to repeat it would just be a second, possibly
      // stale copy of the same fact. `bedId` alone identifies which
      // record to transition, the same way `DischargePatient` only
      // needs `encounterId` and never re-asks for `patientId`.
      readonly kind: 'ReleaseBed';
      readonly bedId: BedId;
      readonly releasedAt: IsoTimestamp;
    };

export type BedEffect =
  | {
      readonly kind: 'BedAssigned';
      readonly bedId: BedId;
      readonly encounterId: EncounterId;
      readonly assignedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'BedReleased';
      readonly bedId: BedId;
      readonly encounterId: EncounterId;
      readonly releasedAt: IsoTimestamp;
    };

export type BedError =
  | { readonly kind: 'BedNotFound'; readonly bedId: BedId }
  | { readonly kind: 'BedAlreadyOccupied'; readonly bedId: BedId }
  | { readonly kind: 'BedNotOccupied'; readonly bedId: BedId };
