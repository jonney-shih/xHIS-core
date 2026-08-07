import type { UiKinded } from './component.js';
import type { PlanProposal } from '../planning/proposal.js';
import type { VerifyDecision } from '../verification/verifier.js';
import type { BedInstruction } from '../../instructions/bed/types.js';

export interface ApprovalConfirmationPanelProps {
  readonly bedIds: readonly string[];
  readonly instructionSummary: readonly string[];
  readonly riskReasons: readonly string[];
  readonly modelVersion: string;
  readonly promptVersion: string;
}

/**
 * The bed domain's first real UI component — the second domain (after
 * patient) to get this exact wiring, and the domain that surfaced the
 * one genuine difference worth recording: patient's `ApprovalConfirmationPanel`
 * tracks `encounterIds` because that's the field every `PatientInstruction`
 * carries; bed's tracks `bedIds` instead, because `ReleaseBed` deliberately
 * carries no `encounterId` at all (see `BedInstruction`'s own doc
 * comment — the bed being released already has one on record, and
 * re-asking for it would just be a second, possibly stale copy).
 * `bedId` is the one field both `AssignBed` and `ReleaseBed` always
 * carry, so it's the correct "primary identifier" for this panel to
 * track, not a mechanical copy of patient's field choice.
 */
export type BedApprovalUiComponent = {
  readonly component: 'ApprovalConfirmationPanel';
  readonly props: ApprovalConfirmationPanelProps;
};

type _AssertUiKinded = BedApprovalUiComponent extends UiKinded ? true : never;
void (0 as unknown as _AssertUiKinded);

function summarizeInstruction(instruction: BedInstruction): string {
  switch (instruction.kind) {
    case 'AssignBed':
      return `AssignBed — ${instruction.bedId} / ${instruction.encounterId}`;
    case 'ReleaseBed':
      return `ReleaseBed — ${instruction.bedId}`;
  }
}

/**
 * Deterministically derives the fixed approval-confirmation panel from
 * an already-Checked proposal — same "harness-derived, never run
 * through `toUiRenderProposal`'s validation gate" reasoning
 * `patient.ts`'s `deriveApprovalConfirmationPanel` doc comment already
 * gives in full; not repeated here beyond the one thing genuinely
 * different (`bedIds`, not `encounterIds` — see this file's own
 * `BedApprovalUiComponent` doc comment).
 */
export function deriveApprovalConfirmationPanel(
  proposal: PlanProposal<BedInstruction>,
  decision: Extract<VerifyDecision, { kind: 'needs-human-approval' }>,
): BedApprovalUiComponent {
  return {
    component: 'ApprovalConfirmationPanel',
    props: {
      bedIds: [...new Set(proposal.instructions.map((instruction) => instruction.bedId as string))],
      instructionSummary: proposal.instructions.map(summarizeInstruction),
      riskReasons: decision.reasons,
      modelVersion: proposal.modelVersion,
      promptVersion: proposal.promptVersion,
    },
  };
}
