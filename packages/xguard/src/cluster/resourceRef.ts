/**
 * Neither `ContainerId` nor `DeploymentId` carries a Kubernetes
 * namespace anywhere upstream (see `instructions/ids.ts` — both are
 * plain branded strings, same as every other id in this package). A
 * real cluster API call needs a namespace, so this package defines its
 * own convention rather than silently guessing a default one: the id
 * itself is `"<namespace>/<name>"`, and for `ContainerId`
 * specifically `"<namespace>/<podName>/<containerName>"`, since
 * restarting "a container" only has a real cluster meaning relative
 * to the pod it lives in (see `containerRestarter.ts`'s own doc
 * comment on why restarting means deleting that pod).
 *
 * `NodeId` needs no such parsing — Kubernetes `Node` objects are
 * cluster-scoped, not namespaced.
 *
 * This is a documented convention of this package, not a Kubernetes
 * concept. Nothing in this workspace produces a real `ContainerId`/
 * `DeploymentId` yet (`instructions/handlers/{restartContainer,
 * scaleDeployment}.ts` are still stubs — see their own doc comments),
 * so there is no real caller to migrate; whatever starts constructing
 * one for real needs to follow this shape for `cluster/kubernetes*.ts`
 * to resolve it correctly.
 */
export class MalformedResourceIdError extends Error {
  constructor(idKind: string, value: string, expectedShape: string) {
    super(`${idKind} "${value}" is not in the expected "${expectedShape}" shape`);
    this.name = 'MalformedResourceIdError';
  }
}

export interface NamespacedName {
  readonly namespace: string;
  readonly name: string;
}

export function parseNamespacedName(idKind: string, value: string): NamespacedName {
  const parts = value.split('/');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    throw new MalformedResourceIdError(idKind, value, '<namespace>/<name>');
  }
  return { namespace: parts[0]!, name: parts[1]! };
}

export interface NamespacedPodContainerRef {
  readonly namespace: string;
  readonly podName: string;
  readonly containerName: string;
}

export function parseNamespacedPodContainerRef(idKind: string, value: string): NamespacedPodContainerRef {
  const parts = value.split('/');
  if (parts.length !== 3 || parts.some((part) => part === '')) {
    throw new MalformedResourceIdError(idKind, value, '<namespace>/<podName>/<containerName>');
  }
  return { namespace: parts[0]!, podName: parts[1]!, containerName: parts[2]! };
}
