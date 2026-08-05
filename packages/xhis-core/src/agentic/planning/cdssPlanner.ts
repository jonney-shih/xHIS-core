import { ok, type Result } from '../../core/execution/result.js';
import type { EncounterId, PatientId } from '../../instructions/patient/ids.js';
import type { PatientContext } from '../../instructions/patient/types.js';
import type { RawUiRenderOutput } from '../ui/toUiRenderProposal.js';
import type { PlanningGoal } from './proposal.js';
import type { RawPlanner, RawPlanOutput } from './toPlanProposal.js';

/**
 * A structured triage flag from an upstream clinical system — not free
 * text like an LLM's `goal.description`. This is the actual point of
 * `createCdssTriagePlanner`: the rule evaluates codified, structured
 * data against a codified condition; it never does natural-language
 * interpretation the way `patientPromptBuilder`/an LLM completion does.
 */
export interface TriageSignal {
  readonly patientId: PatientId;
  readonly encounterId: EncounterId;
  readonly severity: 'emergent' | 'urgent' | 'routine';
}

/**
 * `RawPlanner<TCtx>`'s `TCtx` is "whatever informs planning," not
 * necessarily the domain's own execution context — `patientEngine`'s
 * `executeSequence` only ever sees a plain `PatientContext`, entirely
 * decoupled from whatever this planner needed to decide what to
 * propose. Bundling the current `PatientContext` alongside `signals`
 * here, rather than reaching for ambient patient state, keeps `plan`
 * a pure function of its own arguments — the same discipline
 * `core/execution` handlers follow, even though nothing here requires
 * a `RawPlanner` to follow it (see `proposal.ts`'s doc comment).
 */
export interface CdssTriageContext {
  readonly patientContext: PatientContext;
  readonly signals: readonly TriageSignal[];
}

/**
 * A third planner *shape*, alongside `stubPlanner.ts` (always the same
 * fixed instructions) and `llmPlanner.ts` (calls out to a model): a rule
 * evaluated deterministically against structured input. It implements
 * the exact same untrusted `RawPlanner<TCtx>` contract `createLlmPlanner`
 * does, with zero special-casing — see
 * docs/DETERMINISTIC_CORE_PATTERN.md's "Resolved: CDSS as a Plan source"
 * for what building this actually proved.
 *
 * The rule: for every `emergent` signal whose encounter doesn't already
 * exist in `patientContext`, recommend admitting that patient. A
 * plausible, minimal stand-in for a real triage-acuity CDSS rule, not a
 * production one — same restraint this codebase applies elsewhere to
 * not inventing clinical content it has no authority over (see
 * `lab/types.ts`'s `testCode` staying a plain string). Already-admitted
 * encounters are skipped, not re-proposed — the same idempotency
 * discipline `patientToBed.ts`'s `EncounterAdmitted` case follows,
 * since nothing here stops the same signal being handed to this planner
 * more than once.
 */
export function createCdssTriagePlanner(): RawPlanner<CdssTriageContext> {
  return {
    async plan(
      _goal: PlanningGoal,
      context: CdssTriageContext,
      proposedAt: string,
      _feedback: readonly string[],
    ): Promise<Result<RawPlanOutput, string>> {
      const instructions = context.signals
        .filter((signal) => signal.severity === 'emergent' && !context.patientContext.encounters[signal.encounterId])
        .map((signal) => ({
          kind: 'AdmitPatient',
          patientId: signal.patientId,
          encounterId: signal.encounterId,
          admittedAt: proposedAt,
        }));

      return ok({
        instructions,
        rationale: `CDSS triage rule: recommending admission for ${instructions.length} emergent signal(s) not yet admitted`,
        // Repurposed, not misused: this planner has no model and no
        // prompt at all, but `RawPlanOutput`'s provenance fields still
        // need to say *something* auditable about what produced this
        // proposal — the rule engine's own version stands in for
        // `modelVersion`, a ruleset identifier stands in for
        // `promptVersion`. That these field names carry LLM-shaped
        // assumptions is itself part of what this exercise found, not
        // hidden from it.
        modelVersion: 'cdss-triage-rule-engine-v1',
        promptVersion: 'triage-ruleset-v1',
      });
    },
  };
}

/**
 * CDSS's own UI-suggestion rule — the counterpart to `plan`'s
 * instruction-suggestion rule above, applied to Guardrail #2's own
 * "vital sign entries" example instead of an admission instruction.
 * Deliberately its own function, not folded into `plan`: a
 * `UiRenderProposal` is a separate Plan-source output from a
 * `PlanProposal` (see `ui/proposal.ts`'s own doc comment on why they
 * stay parallel rather than combined — Option A over Option B, in the
 * design discussion this slice was built from), so there is no single
 * `RawPlanOutput` shape for this to live inside.
 *
 * Returns the *raw*, still-untrusted shape `toUiRenderProposal` expects
 * — same "CDSS is not exempt from risk-tiered human approval... regardless
 * of how deterministic the source rule was" principle this file's own
 * `plan` already proved for instructions, now proved for UI: being a
 * deterministic rule doesn't exempt this output from the same
 * validation gate an LLM's raw JSON would have to pass through
 * `toUiRenderProposal`/`resolveUiRenderOutcome`.
 */
export function suggestVitalsEntryPanel(signal: TriageSignal): RawUiRenderOutput {
  return {
    component: { component: 'VitalsEntryPanel', props: { encounterId: signal.encounterId, patientId: signal.patientId } },
    rationale: 'CDSS triage rule: suggesting vitals entry for a newly recommended admission',
    modelVersion: 'cdss-triage-rule-engine-v1',
    promptVersion: 'triage-ruleset-v1',
  };
}
