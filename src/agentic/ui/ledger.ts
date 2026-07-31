import type { UiKinded } from './component.js';
import type { PlanProposal } from '../planning/proposal.js';
import type { VerifyDecision } from '../verification/verifier.js';
import type { LedgerInstruction } from '../../instructions/ledger/types.js';

export interface ApprovalConfirmationPanelProps {
  readonly entryIds: readonly string[];
  readonly instructionSummary: readonly string[];
  readonly riskReasons: readonly string[];
  readonly modelVersion: string;
  readonly promptVersion: string;
}

/**
 * The ledger domain's `ApprovalConfirmationPanel` — the sixth domain
 * (after patient, bed, lab, pharmacy, and scheduling) to get this
 * wiring. Tracks `entryIds`, the same "pick the field every instruction
 * kind actually carries" reasoning `ui/bed.ts`'s `bedIds`, `ui/lab.ts`'s
 * `orderIds`, `ui/pharmacy.ts`'s `prescriptionIds`, and
 * `ui/scheduling.ts`'s `bookingIds` already establish — both `PostEntry`
 * and `ReverseEntry` carry `entryId`, unlike `lines`/`memo`/`postedAt`,
 * which only `PostEntry` carries.
 */
export type LedgerApprovalUiComponent = {
  readonly component: 'ApprovalConfirmationPanel';
  readonly props: ApprovalConfirmationPanelProps;
};

type _AssertUiKinded = LedgerApprovalUiComponent extends UiKinded ? true : never;
void (0 as unknown as _AssertUiKinded);

function summarizeInstruction(instruction: LedgerInstruction): string {
  switch (instruction.kind) {
    case 'PostEntry':
      return `PostEntry — ${instruction.entryId} / ${instruction.lines.length} line(s)`;
    case 'ReverseEntry':
      return `ReverseEntry — ${instruction.entryId}`;
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
  proposal: PlanProposal<LedgerInstruction>,
  decision: Extract<VerifyDecision, { kind: 'needs-human-approval' }>,
): LedgerApprovalUiComponent {
  return {
    component: 'ApprovalConfirmationPanel',
    props: {
      entryIds: [...new Set(proposal.instructions.map((instruction) => instruction.entryId as string))],
      instructionSummary: proposal.instructions.map(summarizeInstruction),
      riskReasons: decision.reasons,
      modelVersion: proposal.modelVersion,
      promptVersion: proposal.promptVersion,
    },
  };
}
