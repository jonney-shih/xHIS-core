import type { UiKinded } from './component.js';
import type { PlanProposal } from '../planning/proposal.js';
import type { VerifyDecision } from '../verification/verifier.js';
import type { LabInstruction } from '../../instructions/lab/types.js';

export interface ApprovalConfirmationPanelProps {
  readonly orderIds: readonly string[];
  readonly instructionSummary: readonly string[];
  readonly riskReasons: readonly string[];
  readonly modelVersion: string;
  readonly promptVersion: string;
}

/**
 * The lab domain's first real UI component — the third domain (after
 * patient, then bed) to get this wiring. Tracks `orderIds`, not
 * `encounterIds` — the same "pick the field every instruction kind
 * actually carries" reasoning `ui/bed.ts`'s own doc comment already
 * gives for choosing `bedIds`: `ReportLabResult` and `CancelLabOrder`
 * carry no `encounterId` at all (only `OrderLabTest` does), but every
 * `LabInstruction` variant carries `orderId`.
 */
export type LabApprovalUiComponent = {
  readonly component: 'ApprovalConfirmationPanel';
  readonly props: ApprovalConfirmationPanelProps;
};

type _AssertUiKinded = LabApprovalUiComponent extends UiKinded ? true : never;
void (0 as unknown as _AssertUiKinded);

function summarizeInstruction(instruction: LabInstruction): string {
  switch (instruction.kind) {
    case 'OrderLabTest':
      return `OrderLabTest — ${instruction.orderId} / ${instruction.testCode}`;
    case 'ReportLabResult':
      return `ReportLabResult — ${instruction.orderId}`;
    case 'CancelLabOrder':
      return `CancelLabOrder — ${instruction.orderId}`;
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
  proposal: PlanProposal<LabInstruction>,
  decision: Extract<VerifyDecision, { kind: 'needs-human-approval' }>,
): LabApprovalUiComponent {
  return {
    component: 'ApprovalConfirmationPanel',
    props: {
      orderIds: [...new Set(proposal.instructions.map((instruction) => instruction.orderId as string))],
      instructionSummary: proposal.instructions.map(summarizeInstruction),
      riskReasons: decision.reasons,
      modelVersion: proposal.modelVersion,
      promptVersion: proposal.promptVersion,
    },
  };
}
