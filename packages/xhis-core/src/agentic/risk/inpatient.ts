import type { InpatientInstruction } from '../../instructions/inpatient/types.js';
import type { RiskTierRegistry } from './tiers.js';

/**
 * The tenth domain to get real agentic-layer integration.
 *
 * `AssignWard` gets `'review-required'`: the first ward assignment for
 * an encounter, correctable via `TransferWard` if wrong — the same
 * "correctable, lower-consequence" reasoning `AdmitPatient`/
 * `outpatient`'s own `CheckInPatient` get that tier for.
 *
 * `RecordProgressNote` also gets `'review-required'`, not `'auto'` —
 * same reasoning `outpatient`'s `RecordSoapNote` already gives: no
 * domain in this codebase uses `'auto'` at all (it skips human review
 * entirely), and a draft note being low-consequence on its own doesn't
 * make this the first exception.
 *
 * `FinalizeProgressNote` gets `'approval-required'`: finalizing makes a
 * note part of the legal medical record, checked directly against
 * `finalizeProgressNoteHandler`, which has no way to un-finalize or
 * amend a finalized note — the same terminal-consequence shape
 * `outpatient`'s own `FinalizeSoapNote` earns this tier for. Arguably
 * higher-stakes here than in `outpatient`: a wrong inpatient progress
 * note can misinform the very next shift's rounding decisions, not
 * just a later reader of a closed visit.
 *
 * `TransferWard` gets `'approval-required'`: checked directly against
 * `transferWardHandler`, not assumed — it permanently ends the current
 * assignment (`status: 'ended'`) with no `ReactivateWardAssignment`
 * instruction to undo it, and a wrong transfer moves care
 * accountability to the wrong service/attending with real continuity-
 * of-care consequences — the same "terminal within this domain, no
 * undo" shape `CompleteEncounter`/`ReverseEntry`/`GrantRole` each earn
 * their own top tier for.
 *
 * Any new `InpatientInstruction` variant added without a tier here
 * fails to compile; see `__typetests__/inpatient.exhaustiveness.ts`
 * for the proof.
 */
export const inpatientRiskTiers = {
  AssignWard: 'review-required',
  TransferWard: 'approval-required',
  RecordProgressNote: 'review-required',
  FinalizeProgressNote: 'approval-required',
} satisfies RiskTierRegistry<InpatientInstruction>;
