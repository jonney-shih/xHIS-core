import type { UiKinded } from './component.js';
import type { PlanProposal } from '../planning/proposal.js';
import type { VerifyDecision } from '../verification/verifier.js';
import type { PatientInstruction } from '../../instructions/patient/types.js';

export interface ApprovalConfirmationPanelProps {
  readonly encounterIds: readonly string[];
  readonly instructionSummary: readonly string[];
  readonly riskReasons: readonly string[];
  readonly modelVersion: string;
  readonly promptVersion: string;
}

/**
 * The patient domain's first real (not illustrative) UI component — the
 * fixed panel a human sees for a proposal Check has already marked
 * `needs-human-approval`. A single-member union today, kept in the same
 * closed-union shape `component.ts`'s doc comment describes anyway:
 * this is the domain's real, growing set of UI descriptors it may ever
 * propose, not a test fixture — `tests/agentic/ui/fixtures/exampleComponents.ts`
 * is the one that stays illustrative-only.
 */
export type PatientApprovalUiComponent = {
  readonly component: 'ApprovalConfirmationPanel';
  readonly props: ApprovalConfirmationPanelProps;
};

// `PatientApprovalUiComponent` already satisfies `UiKinded` structurally;
// this line is just documentation of that fact, same role
// `_AssertKinded`/`_AssertUiKinded` play in the other fixtures/domains.
type _AssertUiKinded = PatientApprovalUiComponent extends UiKinded ? true : never;
void (0 as unknown as _AssertUiKinded);

function summarizeInstruction(instruction: PatientInstruction): string {
  switch (instruction.kind) {
    case 'AdmitPatient':
      return `AdmitPatient — ${instruction.patientId} / ${instruction.encounterId}`;
    case 'DischargePatient':
      return `DischargePatient — ${instruction.encounterId}`;
  }
}

/**
 * Deterministically derives the fixed approval-confirmation panel from
 * an already-Checked proposal — never Agent-selected, and deliberately
 * never run through `toUiRenderProposal`'s validation gate, because
 * nothing untrusted is involved here at all: every field is read from
 * data Check has already computed (the proposal it validated, and the
 * decision it reached). This is Guardrail #2's "100% fixed and
 * predictable" taken literally — there is exactly one possible UI for
 * "this proposal needs human approval," and it is derived by the
 * harness, not chosen by the Agent, so there is nothing here for an
 * LLM's hallucination to reach.
 *
 * Only defined for the patient domain so far, deliberately not
 * generalized over `TInstruction` — the same "extract once a second
 * real domain needs it, not before" precedent `core/temporal.ts`'s
 * `Tick`/`IsoTimestamp` already followed. `summarizeInstruction`'s
 * exhaustive `switch` is the only part that's genuinely
 * patient-specific; generalizing this would mean guessing at that
 * shape for a domain that doesn't exist yet.
 */
export function deriveApprovalConfirmationPanel(
  proposal: PlanProposal<PatientInstruction>,
  decision: Extract<VerifyDecision, { kind: 'needs-human-approval' }>,
): PatientApprovalUiComponent {
  return {
    component: 'ApprovalConfirmationPanel',
    props: {
      encounterIds: [...new Set(proposal.instructions.map((instruction) => instruction.encounterId as string))],
      instructionSummary: proposal.instructions.map(summarizeInstruction),
      riskReasons: decision.reasons,
      modelVersion: proposal.modelVersion,
      promptVersion: proposal.promptVersion,
    },
  };
}
