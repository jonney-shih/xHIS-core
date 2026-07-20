import type { HandlerRegistry } from '../../../core/execution/handler.js';
import type { LedgerContext, LedgerEffect, LedgerError, LedgerInstruction } from '../types.js';
import { postEntryHandler } from './postEntry.js';
import { reverseEntryHandler } from './reverseEntry.js';

export const ledgerHandlerRegistry = {
  PostEntry: postEntryHandler,
  ReverseEntry: reverseEntryHandler,
} satisfies HandlerRegistry<LedgerContext, LedgerInstruction, LedgerEffect, LedgerError>;
