import type { UiKinded } from './component.js';
import type { PlanProposal } from '../planning/proposal.js';
import type { VerifyDecision } from '../verification/verifier.js';
import type { PharmacyInstruction } from '../../instructions/pharmacy/types.js';

export interface ApprovalConfirmationPanelProps {
  readonly prescriptionIds: readonly string[];
  readonly instructionSummary: readonly string[];
  readonly riskReasons: readonly string[];
  readonly modelVersion: string;
  readonly promptVersion: string;
}

/**
 * The pharmacy domain's `ApprovalConfirmationPanel` — the fourth domain
 * (after patient, bed, and lab) to get this wiring. Tracks
 * `prescriptionIds`, the same "pick the field every instruction kind
 * actually carries" reasoning `ui/bed.ts`'s `bedIds` and `ui/lab.ts`'s
 * `orderIds` already establish: `DispenseMedication` carries no
 * `encounterId` at all (only `PrescribeMedication` does), but every
 * `PharmacyInstruction` variant carries `prescriptionId`.
 */
export type PharmacyApprovalUiComponent = {
  readonly component: 'ApprovalConfirmationPanel';
  readonly props: ApprovalConfirmationPanelProps;
};

type _AssertUiKinded = PharmacyApprovalUiComponent extends UiKinded ? true : never;
void (0 as unknown as _AssertUiKinded);

function summarizeInstruction(instruction: PharmacyInstruction): string {
  switch (instruction.kind) {
    case 'PrescribeMedication':
      return `PrescribeMedication — ${instruction.prescriptionId} / ${instruction.medicationCode}`;
    case 'DispenseMedication':
      return `DispenseMedication — ${instruction.prescriptionId}`;
  }
}

/**
 * Deterministically derives the fixed approval-confirmation panel from
 * an already-Checked proposal — same "harness-derived, never run
 * through `toUiRenderProposal`'s validation gate" reasoning
 * `patient.ts`'s `deriveApprovalConfirmationPanel` doc comment gives in
 * full, not repeated here.
 */
export function deriveApprovalConfirmationPanel(
  proposal: PlanProposal<PharmacyInstruction>,
  decision: Extract<VerifyDecision, { kind: 'needs-human-approval' }>,
): PharmacyApprovalUiComponent {
  return {
    component: 'ApprovalConfirmationPanel',
    props: {
      prescriptionIds: [...new Set(proposal.instructions.map((instruction) => instruction.prescriptionId as string))],
      instructionSummary: proposal.instructions.map(summarizeInstruction),
      riskReasons: decision.reasons,
      modelVersion: proposal.modelVersion,
      promptVersion: proposal.promptVersion,
    },
  };
}
