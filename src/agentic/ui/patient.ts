import { err, ok, type Result } from '../../core/execution/result.js';
import type { UiKinded } from './component.js';
import type { ComponentPropsValidatorRegistry } from './validator.js';
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

export interface VitalsEntryPanelProps {
  readonly encounterId: string;
  readonly patientId: string;
}

/**
 * The patient domain's first genuinely *Agent-selected* UI component —
 * Guardrail #2's own "vital sign entries" example. Deliberately a
 * separate type from `PatientApprovalUiComponent`, not one union
 * covering both: `ApprovalConfirmationPanel` is harness-derived and
 * never runs through `toUiRenderProposal`'s validation gate (see
 * `deriveApprovalConfirmationPanel`'s own doc comment); `VitalsEntryPanel`
 * is proposed by an Agent (see `planning/cdssPlanner.ts`'s
 * `suggestVitalsEntryPanel`) and always must. Forcing both into one
 * closed union would demand a validator for a component that never
 * actually gets validated in practice — dead code standing in for a
 * guarantee that was never true — the same "a different concern gets a
 * different shape" reasoning that already keeps `AuditRecord` and
 * `HumanActionAuditRecord` separate.
 */
export type PatientVitalsUiComponent = {
  readonly component: 'VitalsEntryPanel';
  readonly props: VitalsEntryPanelProps;
};

type _AssertVitalsUiKinded = PatientVitalsUiComponent extends UiKinded ? true : never;
void (0 as unknown as _AssertVitalsUiKinded);

function validateVitalsEntryPanel(candidate: unknown): Result<PatientVitalsUiComponent, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const props = c['props'] as Record<string, unknown> | undefined;
  const issues: string[] = [];

  if (typeof props?.['encounterId'] !== 'string' || props['encounterId'].length === 0) {
    issues.push("'props.encounterId' must be a non-empty string");
  }
  if (typeof props?.['patientId'] !== 'string' || props['patientId'].length === 0) {
    issues.push("'props.patientId' must be a non-empty string");
  }

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    component: 'VitalsEntryPanel',
    props: { encounterId: props!['encounterId'] as string, patientId: props!['patientId'] as string },
  });
}

/**
 * Assembled as a single object literal checked with `satisfies` — same
 * total-registry proof `exampleComponentPropsValidators` demonstrates
 * for the illustrative fixture, here for the patient domain's first
 * real Agent-selected component.
 */
export const patientVitalsComponentPropsValidators = {
  VitalsEntryPanel: validateVitalsEntryPanel,
} satisfies ComponentPropsValidatorRegistry<PatientVitalsUiComponent>;
