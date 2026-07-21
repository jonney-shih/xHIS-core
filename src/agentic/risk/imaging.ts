import type { ImagingInstruction } from '../../instructions/imaging/types.js';
import type { RiskTierRegistry } from './tiers.js';

/**
 * The fifth domain (after `lab`, `bed`, `ledger`, `scheduling`) to get
 * real agentic-layer integration, continuing to close the gap
 * `docs/DETERMINISTIC_CORE_PATTERN.md` flagged.
 *
 * Imaging is the first domain whose forward lifecycle has three steps,
 * not two (`ordered` -> `performed` -> `reported`), so each instruction
 * was reasoned about individually rather than forced into a fixed ratio
 * of tiers.
 *
 * `OrderStudy` gets `'review-required'`: correctable via `CancelStudy`,
 * the same "correctable, lower-consequence" shape `AdmitPatient` and
 * `OrderLabTest` get that tier for. `CancelStudy` also gets
 * `'review-required'` — checked against `cancelStudyHandler`: it only
 * ever fires while a study is still `'ordered'`, before any image was
 * captured or reported, the exact same "resolves a still-pending order,
 * nothing clinical has happened yet" shape `CancelLabOrder` has, even
 * though (like `CancelBooking`/`ReverseEntry`) it permanently consumes
 * the `studyId` — that fact alone isn't what drives the tier; what
 * matters is that nothing clinical was ever produced under the
 * cancelled order.
 *
 * `RecordStudyStored` was considered for `'approval-required'` — a wrong
 * `storageRef` could associate the wrong patient's images with this
 * study, a real PACS/RIS safety hazard — but landed on
 * `'review-required'` instead: unlike `ReportStudy`, a bad
 * `RecordStudyStored` still has one more domain-modeled checkpoint
 * downstream (the radiologist reading the images before reporting) that
 * has a real chance to catch a wrong-study mismatch before it reaches a
 * clinical decision. `ReportStudy` has no such checkpoint — it *is* the
 * clinical decision, the same terminal-consequence shape
 * `ReportLabResult` and `DischargePatient` earn their own top tier for —
 * so it alone gets `'approval-required'`. Any new `ImagingInstruction`
 * variant added without a tier here fails to compile; see
 * `__typetests__/imaging.exhaustiveness.ts` for the proof.
 */
export const imagingRiskTiers = {
  OrderStudy: 'review-required',
  RecordStudyStored: 'review-required',
  ReportStudy: 'approval-required',
  CancelStudy: 'review-required',
} satisfies RiskTierRegistry<ImagingInstruction>;
