import type { EncounterId, IsoTimestamp, LabOrderId } from './ids.js';

/**
 * A test code is kept as a plain string, not a controlled vocabulary
 * (LOINC or similar) — inventing a real code system before there's a
 * real requirement to validate against one would be guessing, the same
 * reasoning `EXAMPLE_patientApprovalPolicy` documents for role names.
 */
export interface LabOrderRecord {
  readonly orderId: LabOrderId;
  readonly encounterId: EncounterId;
  readonly testCode: string;
  readonly status: 'ordered' | 'resulted' | 'cancelled';
  readonly orderedAt: IsoTimestamp;
  readonly result?: string;
  readonly resultedAt?: IsoTimestamp;
  readonly cancelledAt?: IsoTimestamp;
}

/** Plain, JSON-serializable state — see `PatientContext`'s doc comment
 * for why that matters. */
export interface LabContext {
  readonly orders: Readonly<Record<string, LabOrderRecord>>;
}

/**
 * Three instructions, one more than `patient`/`bed`'s two — specimen
 * collection/receipt tracking, panel/reflex ordering, and result
 * amendment are all real parts of a lab order's lifecycle in a real LIS,
 * and all deliberately out of scope here, same restraint
 * docs/ARCHITECTURE.md applies elsewhere. `CancelLabOrder` exists
 * specifically because `src/integration/patientToLab.ts` needs a real
 * instruction to react with — see that module for why.
 */
export type LabInstruction =
  | {
      readonly kind: 'OrderLabTest';
      readonly orderId: LabOrderId;
      readonly encounterId: EncounterId;
      readonly testCode: string;
      readonly orderedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'ReportLabResult';
      readonly orderId: LabOrderId;
      readonly result: string;
      readonly resultedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'CancelLabOrder';
      readonly orderId: LabOrderId;
      readonly cancelledAt: IsoTimestamp;
    };

export type LabEffect =
  | {
      readonly kind: 'LabTestOrdered';
      readonly orderId: LabOrderId;
      readonly encounterId: EncounterId;
      readonly testCode: string;
      readonly orderedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'LabResultReported';
      readonly orderId: LabOrderId;
      readonly encounterId: EncounterId;
      readonly result: string;
      readonly resultedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'LabOrderCancelled';
      readonly orderId: LabOrderId;
      readonly encounterId: EncounterId;
      readonly cancelledAt: IsoTimestamp;
    };

export type LabError =
  | { readonly kind: 'LabOrderAlreadyExists'; readonly orderId: LabOrderId }
  | { readonly kind: 'LabOrderNotFound'; readonly orderId: LabOrderId }
  | { readonly kind: 'LabOrderNotPending'; readonly orderId: LabOrderId };
