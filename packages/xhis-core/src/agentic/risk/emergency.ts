import type { EmergencyInstruction } from '../../instructions/emergency/types.js';
import type { RiskTierRegistry } from './tiers.js';

/**
 * The twelfth domain to get real agentic-layer integration, and the
 * first whose top-tier instructions outnumber its `'review-required'`
 * ones — reasoned independently below, not copied from that pattern.
 *
 * `RegisterEdVisit` gets `'review-required'`: purely administrative —
 * nothing clinical has happened yet, the same "nothing clinical has
 * happened yet" shape `CheckInPatient`/`OrderLabTest` get that tier
 * for.
 *
 * `TriagePatient` gets `'approval-required'`, a step higher than
 * `outpatient`/`inpatient`'s equivalent "record a draft, not yet
 * authoritative" instructions: an ESI level is a committed clinical
 * determination the instant it's assigned, not a draft awaiting
 * finalization (there is no `FinalizeTriagePatient`), and it directly
 * drives how urgently this patient gets seen — the same "wrong value
 * drives a wrong, and here time-critical, downstream decision" shape
 * `ReportLabResult`/`ReportStudy` earn their own top tier for, with
 * materially less time to notice and correct a mistake.
 *
 * `DispositionPatient` gets `'approval-required'`: checked directly
 * against `dispositionPatientHandler` — ending a visit permanently (no
 * `ReopenEdVisit`), with a wrong disposition (sending home a patient
 * who needed admission, or the reverse) carrying severe, immediate
 * consequences — the same "terminal within this domain, no undo"
 * shape `CompleteEncounter`/`TransferWard`/`ReverseEntry` each earn
 * their own top tier for.
 *
 * Any new `EmergencyInstruction` variant added without a tier here
 * fails to compile; see `__typetests__/emergency.exhaustiveness.ts`
 * for the proof.
 */
export const emergencyRiskTiers = {
  RegisterEdVisit: 'review-required',
  TriagePatient: 'approval-required',
  DispositionPatient: 'approval-required',
} satisfies RiskTierRegistry<EmergencyInstruction>;
