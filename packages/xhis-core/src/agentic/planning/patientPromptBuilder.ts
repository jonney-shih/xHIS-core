import type { PatientContext } from '../../instructions/patient/types.js';
import type { PromptBuilder } from './llmPlanner.js';

const INSTRUCTION_SCHEMA = `
Available instructions — propose ONLY these kinds, with EXACTLY these fields:

- AdmitPatient: { "kind": "AdmitPatient", "patientId": string, "encounterId": string, "admittedAt": ISO-8601 timestamp string }
- DischargePatient: { "kind": "DischargePatient", "encounterId": string, "dischargedAt": ISO-8601 timestamp string }

Do not invent other instruction kinds or add extra fields. Extra fields are
discarded; unrecognized kinds are rejected outright.
`.trim();

/**
 * Illustrative, not authoritative — see docs/AGENTIC_LAYER.md. Two things
 * worth flagging about what this does and doesn't do:
 *
 * - It tells the model not to put identifiers in `rationale`, which is a
 *   real, useful reduction in how often that happens — but it's a request
 *   to the model, not an enforcement mechanism. `verification/pdpaRules.ts`
 *   is the actual enforcement; this is defense-in-depth, not a substitute.
 * - It serializes the *whole* `context.encounters` map into the prompt.
 *   That's acceptable today because `PatientContext` only carries IDs and
 *   timestamps — nothing like a diagnosis or clinical note. If a richer
 *   clinical domain is ever modeled with more sensitive fields, this needs
 *   to become a real minimization step (pick only what planning this goal
 *   actually needs), not stay a blanket dump of the context object.
 */
export const patientPromptBuilder: PromptBuilder<PatientContext> = {
  build(goal, context, feedback) {
    const sections = [
      'You are planning a sequence of patient-encounter instructions for a hospital information system.',
      INSTRUCTION_SCHEMA,
      `Goal:\n${goal.description}`,
      `Current encounters, keyed by encounterId:\n${JSON.stringify(context.encounters)}`,
      'Respond with ONLY a JSON object of the exact shape ' +
        '{ "instructions": [...], "rationale": string }. ' +
        'In "rationale", refer to encounters by encounterId only — never include ' +
        'a patient name, national ID number, phone number, or any other personal identifier.',
    ];

    if (feedback.length > 0) {
      sections.push(`Your previous attempt had these problems — fix them:\n${feedback.map((issue) => `- ${issue}`).join('\n')}`);
    }

    return sections.join('\n\n');
  },
};
