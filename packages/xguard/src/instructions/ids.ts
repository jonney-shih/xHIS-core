type Brand<T, B extends string> = T & { readonly __brand: B };

/**
 * Same branding idiom every clinical domain's own `ids.ts` uses (see
 * `@xhis/core`'s `instructions/bed/ids.ts`) — a plain `string` at
 * runtime, a distinct nominal type at compile time, so a `NodeId` can
 * never be silently substituted for a `SandboxId`.
 */
export type SandboxId = Brand<string, 'SandboxId'>;
export function sandboxId(value: string): SandboxId {
  return value as SandboxId;
}

export type NodeId = Brand<string, 'NodeId'>;
export function nodeId(value: string): NodeId {
  return value as NodeId;
}

export type ContainerId = Brand<string, 'ContainerId'>;
export function containerId(value: string): ContainerId {
  return value as ContainerId;
}

export type DeploymentId = Brand<string, 'DeploymentId'>;
export function deploymentId(value: string): DeploymentId {
  return value as DeploymentId;
}

/**
 * Re-exported from `@xhis/core`, not redefined here — the identical
 * "don't rebrand a same-shaped-but-different type across a domain
 * boundary" discipline `instructions/bed/ids.ts` documents for
 * `EncounterId`. `IsoTimestamp` is genuinely domain-agnostic; the `ops`
 * domain reuses `@xhis/core`'s own, imported only through its public
 * package export — never a deep path into `@xhis/core`'s internals, see
 * `tests/architecture/coreBoundary.guard.test.ts`.
 */
export { isoTimestamp, type IsoTimestamp } from '@xhis/core';
