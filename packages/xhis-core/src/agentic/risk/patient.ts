import type { PatientInstruction } from '../../instructions/patient/types.js';
import type { RiskTierRegistry } from './tiers.js';

/**
 * `AdmitPatient` is correctable and lower-consequence; `DischargePatient` is
 * terminal for the encounter and carries direct MOHW record-completeness
 * and legal weight — see docs/AGENTIC_LAYER.md for the rationale. Any new
 * `PatientInstruction` variant added without a tier here fails to compile;
 * see __typetests__/exhaustiveness.ts for the proof.
 */
export const patientRiskTiers = {
  AdmitPatient: 'review-required',
  DischargePatient: 'approval-required',
} satisfies RiskTierRegistry<PatientInstruction>;
