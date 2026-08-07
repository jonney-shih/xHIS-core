import type { UiKinded } from './component.js';
import type { PlanProposal } from '../planning/proposal.js';
import type { VerifyDecision } from '../verification/verifier.js';
import type { SchedulingInstruction } from '../../instructions/scheduling/types.js';

export interface ApprovalConfirmationPanelProps {
  readonly bookingIds: readonly string[];
  readonly instructionSummary: readonly string[];
  readonly riskReasons: readonly string[];
  readonly modelVersion: string;
  readonly promptVersion: string;
}

/**
 * The scheduling domain's `ApprovalConfirmationPanel` — the fifth domain
 * (after patient, bed, lab, and pharmacy) to get this wiring. Tracks
 * `bookingIds`, the same "pick the field every instruction kind
 * actually carries" reasoning `ui/bed.ts`'s `bedIds`, `ui/lab.ts`'s
 * `orderIds`, and `ui/pharmacy.ts`'s `prescriptionIds` already
 * establish — both `ScheduleBooking` and `CancelBooking` carry
 * `bookingId`, unlike `resourceId`/`subjectId`/`startAt`/`endAt`, which
 * only `ScheduleBooking` carries.
 */
export type SchedulingApprovalUiComponent = {
  readonly component: 'ApprovalConfirmationPanel';
  readonly props: ApprovalConfirmationPanelProps;
};

type _AssertUiKinded = SchedulingApprovalUiComponent extends UiKinded ? true : never;
void (0 as unknown as _AssertUiKinded);

function summarizeInstruction(instruction: SchedulingInstruction): string {
  switch (instruction.kind) {
    case 'ScheduleBooking':
      return `ScheduleBooking — ${instruction.bookingId} / ${instruction.resourceId}`;
    case 'CancelBooking':
      return `CancelBooking — ${instruction.bookingId}`;
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
  proposal: PlanProposal<SchedulingInstruction>,
  decision: Extract<VerifyDecision, { kind: 'needs-human-approval' }>,
): SchedulingApprovalUiComponent {
  return {
    component: 'ApprovalConfirmationPanel',
    props: {
      bookingIds: [...new Set(proposal.instructions.map((instruction) => instruction.bookingId as string))],
      instructionSummary: proposal.instructions.map(summarizeInstruction),
      riskReasons: decision.reasons,
      modelVersion: proposal.modelVersion,
      promptVersion: proposal.promptVersion,
    },
  };
}
