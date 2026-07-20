import type { HandlerRegistry } from '../../../../core/execution/handler.js';
import type { LedgerContext, LedgerEffect, LedgerError, LedgerInstruction } from '../../types.js';
import { postEntryHandler } from '../postEntry.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). The
 * compile-time proof that `ledgerHandlerRegistry` is total over
 * `LedgerInstruction`: omitting a handler here must fail to compile.
 */
const incomplete = {
  PostEntry: postEntryHandler,
  // @ts-expect-error - ReverseEntry intentionally omitted to prove the registry is total
} satisfies HandlerRegistry<LedgerContext, LedgerInstruction, LedgerEffect, LedgerError>;

void incomplete;
