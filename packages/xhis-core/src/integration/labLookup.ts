import { labOrderId } from '../instructions/lab/ids.js';
import type { EncounterId, LabOrderId } from '../instructions/lab/ids.js';
import type { LabContext } from '../instructions/lab/types.js';

/**
 * Every still-`'ordered'` (not yet resulted or cancelled) order for a
 * given encounter — plural, unlike `bedLookup.ts`'s `findBedHoldingEncounter`,
 * because an encounter can have many pending lab orders at once but at
 * most one occupied bed. Sorted for determinism, same reasoning as
 * `findBedHoldingEncounter`'s `matches.sort()`.
 */
export function findPendingLabOrdersForEncounter(context: LabContext, encounterId: EncounterId): readonly LabOrderId[] {
  return Object.keys(context.orders)
    .filter((id) => {
      const order = context.orders[id];
      return order.status === 'ordered' && order.encounterId === encounterId;
    })
    .map((id) => labOrderId(id))
    .sort();
}
