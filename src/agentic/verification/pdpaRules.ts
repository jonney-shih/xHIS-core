import type { Kinded } from '../../core/execution/kinded.js';
import type { Verifier } from './verifier.js';

/**
 * Heuristic, non-exhaustive shape patterns for identifiers that shouldn't
 * appear in free text — not a general PII/DLP scanner. `pattern` matches
 * the *shape* only (e.g. a Taiwan National ID has a checksum digit this
 * doesn't verify); false negatives are expected for anything not listed
 * here, and this is not a substitute for actually minimizing what's handed
 * to the planner in the first place (see docs/AGENTIC_LAYER.md's PDPA
 * restrictions).
 */
const SENSITIVE_TEXT_PATTERNS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: 'a Taiwan National ID number', pattern: /\b[A-Z][12]\d{8}\b/ },
  { label: 'a Taiwan mobile phone number', pattern: /\b09\d{2}-?\d{3}-?\d{3}\b/ },
];

/**
 * The one place in a proposal an LLM can put arbitrary free text is
 * `rationale` — `instructions` is schema-constrained by the validator (see
 * `validation/validator.ts`), which already drops any field the closed
 * `Instruction` union doesn't declare. This rule catches the free-text
 * escape hatch: `reject`, not `needs-human-approval`, because a human
 * approving a proposal doesn't fix the underlying problem — an
 * already-leaked identifier would still get written into the audit
 * record's `rationale` field the moment Act commits it.
 */
export function createRationalePiiScanVerifier<TInstruction extends Kinded>(): Verifier<TInstruction> {
  return {
    verify(proposal) {
      const matches = SENSITIVE_TEXT_PATTERNS.filter(({ pattern }) => pattern.test(proposal.rationale));

      if (matches.length === 0) {
        return { kind: 'accept' };
      }

      return {
        kind: 'reject',
        reasons: matches.map(
          ({ label }) => `rationale appears to contain ${label} — must be removed before this proposal can be re-planned`,
        ),
      };
    },
  };
}
