import type { UiKinded } from './component.js';
import type { PlanProposal } from '../planning/proposal.js';
import type { VerifyDecision } from '../verification/verifier.js';
import type { NursingInstruction } from '../../instructions/nursing/types.js';

export interface ApprovalConfirmationPanelProps {
  readonly credentialIds: readonly string[];
  readonly instructionSummary: readonly string[];
  readonly riskReasons: readonly string[];
  readonly modelVersion: string;
  readonly promptVersion: string;
}

/**
 * The nursing domain's `ApprovalConfirmationPanel` — the eighth, and
 * last, domain to get this wiring, closing the Generative UI contract's
 * coverage across every domain in this codebase. Tracks `credentialIds`,
 * the same "pick the field every instruction kind actually carries"
 * reasoning `ui/bed.ts`'s `bedIds` through `ui/imaging.ts`'s `studyIds`
 * already establish — but the first domain where that field isn't
 * uniformly a record's *own* identifier: `IssueCredential`/
 * `RevokeCredential` carry `credentialId` as their own primary key, but
 * `GrantRole`'s own identifier is `grantId` — it carries `credentialId`
 * only as a foreign key to the credential backing the grant. It's still
 * the one field every `NursingInstruction` variant carries, which is
 * the actual criterion this panel has always used, not "the subject's
 * own primary key" specifically.
 */
export type NursingApprovalUiComponent = {
  readonly component: 'ApprovalConfirmationPanel';
  readonly props: ApprovalConfirmationPanelProps;
};

type _AssertUiKinded = NursingApprovalUiComponent extends UiKinded ? true : never;
void (0 as unknown as _AssertUiKinded);

function summarizeInstruction(instruction: NursingInstruction): string {
  switch (instruction.kind) {
    case 'IssueCredential':
      return `IssueCredential — ${instruction.credentialId} / ${instruction.credentialType}`;
    case 'RevokeCredential':
      return `RevokeCredential — ${instruction.credentialId}`;
    case 'GrantRole':
      return `GrantRole — ${instruction.grantId} / ${instruction.role} / ${instruction.credentialId}`;
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
  proposal: PlanProposal<NursingInstruction>,
  decision: Extract<VerifyDecision, { kind: 'needs-human-approval' }>,
): NursingApprovalUiComponent {
  return {
    component: 'ApprovalConfirmationPanel',
    props: {
      credentialIds: [...new Set(proposal.instructions.map((instruction) => instruction.credentialId as string))],
      instructionSummary: proposal.instructions.map(summarizeInstruction),
      riskReasons: decision.reasons,
      modelVersion: proposal.modelVersion,
      promptVersion: proposal.promptVersion,
    },
  };
}
