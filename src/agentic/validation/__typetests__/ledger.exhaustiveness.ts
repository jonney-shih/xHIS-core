import { validatePostEntry } from '../ledger.js';
import type { LedgerInstruction } from '../../../instructions/ledger/types.js';
import type { InstructionValidatorRegistry } from '../validator.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `ledgerInstructionValidators` is total over
 * `LedgerInstruction`: omitting a validator here must fail to compile.
 */
const incomplete = {
  PostEntry: validatePostEntry,
  // @ts-expect-error - ReverseEntry intentionally omitted to prove the registry is total
} satisfies InstructionValidatorRegistry<LedgerInstruction>;

void incomplete;
