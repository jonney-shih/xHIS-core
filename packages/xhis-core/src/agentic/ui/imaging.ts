import type { UiKinded } from './component.js';
import type { PlanProposal } from '../planning/proposal.js';
import type { VerifyDecision } from '../verification/verifier.js';
import type { ImagingInstruction } from '../../instructions/imaging/types.js';

export interface ApprovalConfirmationPanelProps {
  readonly studyIds: readonly string[];
  readonly instructionSummary: readonly string[];
  readonly riskReasons: readonly string[];
  readonly modelVersion: string;
  readonly promptVersion: string;
}

/**
 * The imaging domain's `ApprovalConfirmationPanel` — the seventh domain
 * (after patient, bed, lab, pharmacy, scheduling, and ledger) to get
 * this wiring. Tracks `studyIds`, the same "pick the field every
 * instruction kind actually carries" reasoning `ui/bed.ts`'s `bedIds`,
 * `ui/lab.ts`'s `orderIds`, `ui/pharmacy.ts`'s `prescriptionIds`,
 * `ui/scheduling.ts`'s `bookingIds`, and `ui/ledger.ts`'s `entryIds`
 * already establish — all four `ImagingInstruction` variants carry
 * `studyId`, unlike `encounterId`/`modality` (only `OrderStudy`) or
 * `storageRef` (only `RecordStudyStored`).
 */
export type ImagingApprovalUiComponent = {
  readonly component: 'ApprovalConfirmationPanel';
  readonly props: ApprovalConfirmationPanelProps;
};

type _AssertUiKinded = ImagingApprovalUiComponent extends UiKinded ? true : never;
void (0 as unknown as _AssertUiKinded);

function summarizeInstruction(instruction: ImagingInstruction): string {
  switch (instruction.kind) {
    case 'OrderStudy':
      return `OrderStudy — ${instruction.studyId} / ${instruction.modality}`;
    case 'RecordStudyStored':
      return `RecordStudyStored — ${instruction.studyId}`;
    case 'ReportStudy':
      return `ReportStudy — ${instruction.studyId}`;
    case 'CancelStudy':
      return `CancelStudy — ${instruction.studyId}`;
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
  proposal: PlanProposal<ImagingInstruction>,
  decision: Extract<VerifyDecision, { kind: 'needs-human-approval' }>,
): ImagingApprovalUiComponent {
  return {
    component: 'ApprovalConfirmationPanel',
    props: {
      studyIds: [...new Set(proposal.instructions.map((instruction) => instruction.studyId as string))],
      instructionSummary: proposal.instructions.map(summarizeInstruction),
      riskReasons: decision.reasons,
      modelVersion: proposal.modelVersion,
      promptVersion: proposal.promptVersion,
    },
  };
}
