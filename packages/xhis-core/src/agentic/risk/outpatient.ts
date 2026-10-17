import type { OutpatientInstruction } from '../../instructions/outpatient/types.js';
import type { RiskTierRegistry } from './tiers.js';

/**
 * The ninth domain to get real agentic-layer integration.
 *
 * `CheckInPatient` gets `'review-required'`: purely administrative
 * presence-tracking — nothing clinical has happened yet, the same
 * "nothing clinical has happened yet" shape `lab`'s own `OrderLabTest`
 * and `imaging`'s own `OrderStudy`/`CancelStudy` get that tier for.
 *
 * `RecordSoapNote` also gets `'review-required'`, not `'auto'`, even
 * though it only ever creates a `'draft'` note with no standing
 * clinical weight yet — no domain in this codebase uses `'auto'` at
 * all (see `createRiskTierVerifier`'s own doc comment: `'auto'` skips
 * human review entirely), and a regulated clinical record is not
 * somewhere this domain gets to be the first exception just because a
 * draft is, on its own, low-consequence.
 *
 * `FinalizeSoapNote` gets `'approval-required'`: finalizing makes a
 * note part of the legal medical record — checked directly against
 * `finalizeSoapNoteHandler`, which has no way to un-finalize or amend
 * a finalized note. A wrong finalized note misinforms every future
 * reader of this chart, the same terminal-consequence shape
 * `ReportLabResult`/`ReportStudy`/`DischargePatient` each earn their
 * own top tier for.
 *
 * `PlaceCpoeOrder` gets `'review-required'`: directly comparable to
 * `OrderLabTest`/`OrderStudy`/`PrescribeMedication`, all of which get
 * this tier for being correctable before anything clinical actually
 * happens — and here that's doubly true, since nothing downstream even
 * acts on a placed order yet (see `placeCpoeOrderHandler`'s doc
 * comment); whatever relay eventually drives a real `lab`/`imaging`/
 * `pharmacy` instruction from this effect will go through that
 * domain's own Check as a second, independent gate.
 *
 * `CompleteEncounter` gets `'approval-required'`: checked directly
 * against `completeEncounterHandler`, not assumed — once completed, an
 * encounter can never accept another `RecordSoapNote`/`PlaceCpoeOrder`
 * (both reject on `EncounterNotCheckedIn`), and there is no
 * `ReopenEncounter` instruction. A wrongly-completed visit permanently
 * forecloses adding anything forgotten to its actual chart, forcing a
 * brand-new encounter for whatever was missed — the same "terminal
 * within this domain, no undo" shape `ReverseEntry`/`GrantRole` each
 * get their own top tier for, independently earned here rather than
 * copied from either.
 *
 * Any new `OutpatientInstruction` variant added without a tier here
 * fails to compile; see `__typetests__/outpatient.exhaustiveness.ts`
 * for the proof.
 */
export const outpatientRiskTiers = {
  CheckInPatient: 'review-required',
  RecordSoapNote: 'review-required',
  FinalizeSoapNote: 'approval-required',
  PlaceCpoeOrder: 'review-required',
  CompleteEncounter: 'approval-required',
} satisfies RiskTierRegistry<OutpatientInstruction>;
