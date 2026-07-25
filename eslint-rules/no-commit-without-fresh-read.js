import { ESLintUtils } from '@typescript-eslint/utils';

/**
 * Catches the exact shape of two real bugs found and fixed in this
 * codebase — see docs/DETERMINISTIC_CORE_PATTERN.md's "Resolved:
 * optimistic concurrency check before commit" and its outbox-relay /
 * externalLabResultAdapter follow-ups: calling `.commit(...)` on a
 * value structurally shaped like `{ commit(...): void; readLatest():
 * ... }` without ever calling `.readLatest()` on that same receiver
 * anywhere in the same top-level function. `act()`, `actHuman()`,
 * `relayEffects()`, and `ingestExternalLabResult()` are the four real,
 * current examples of the shape this rule expects to see — each was
 * fixed to call `readLatest()` before `commit()` only after the
 * mistake had already shipped once, undetected.
 *
 * Deliberately a presence check, not an ordering or dataflow proof: it
 * checks "does a `.readLatest()` call on the same identifier appear
 * *anywhere* in the same outermost enclosing function" — not "is it
 * guaranteed to run before this specific commit." Ordering can't be
 * reliably read off source *position* in this codebase's own style:
 * `act()`/`actHuman()` both call `.commit()` from inside a small,
 * once-defined `finalize` closure that many different call sites
 * invoke, while `.readLatest()` is read earlier in a *different*
 * nested closure (`commitAfterFreshCheck`) — `finalize`'s own
 * definition sits *before* `commitAfterFreshCheck`'s in the source
 * text, even though every call that actually reaches a commit calls
 * `commitAfterFreshCheck` (and therefore `readLatest()`) first at
 * runtime. Proving the true execution order would need real
 * control-flow analysis this rule doesn't attempt; catching "was
 * `readLatest()` forgotten entirely" — the actual mistake both bugs
 * were — only needs presence, and presence is what source position
 * can't reliably give you here.
 */
export const noCommitWithoutFreshRead = ESLintUtils.RuleCreator.withoutDocs({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a readLatest() call on the same committer/shell-shaped receiver, somewhere in the same top-level function as a commit() call',
    },
    messages: {
      missingReadLatest:
        "'{{receiver}}.commit(...)' is called here, but this function never calls '{{receiver}}.readLatest()' anywhere. Re-derive against readLatest() (falling back to a baseline context only when nothing has ever committed) before committing -- see docs/DETERMINISTIC_CORE_PATTERN.md's OCC-related 'Resolved' sections for the two real bugs this exact mistake already caused.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);

    function hasReadLatestMethod(objectNode) {
      const type = services.getTypeAtLocation(objectNode);
      return type.getProperty('readLatest') !== undefined;
    }

    function outermostFunctionAncestor(node) {
      let current = node;
      let outer = null;
      while (current) {
        if (
          current.type === 'FunctionDeclaration' ||
          current.type === 'FunctionExpression' ||
          current.type === 'ArrowFunctionExpression'
        ) {
          outer = current;
        }
        current = current.parent;
      }
      return outer;
    }

    function receiverNameOf(callExpression) {
      const callee = callExpression.callee;
      if (callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier') {
        return undefined;
      }
      return callee.object.name;
    }

    const commitCalls = [];
    const readLatestReceiversByBoundary = new Map();

    return {
      'CallExpression[callee.property.name="commit"]'(node) {
        const receiver = receiverNameOf(node);
        if (!receiver || !hasReadLatestMethod(node.callee.object)) {
          return;
        }
        const boundary = outermostFunctionAncestor(node) ?? context.sourceCode.ast;
        commitCalls.push({ node, receiver, boundary });
      },
      'CallExpression[callee.property.name="readLatest"]'(node) {
        const receiver = receiverNameOf(node);
        if (!receiver) {
          return;
        }
        const boundary = outermostFunctionAncestor(node) ?? context.sourceCode.ast;
        const receivers = readLatestReceiversByBoundary.get(boundary) ?? new Set();
        receivers.add(receiver);
        readLatestReceiversByBoundary.set(boundary, receivers);
      },
      'Program:exit'() {
        for (const commitCall of commitCalls) {
          const receivers = readLatestReceiversByBoundary.get(commitCall.boundary);
          if (!receivers || !receivers.has(commitCall.receiver)) {
            context.report({ node: commitCall.node, messageId: 'missingReadLatest', data: { receiver: commitCall.receiver } });
          }
        }
      },
    };
  },
});
