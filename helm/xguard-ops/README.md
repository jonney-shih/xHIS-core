# xguard-ops

Deploys `@xhis/xguard`'s cluster-connectivity smoke test (see
`packages/xguard/src/runner/clusterConnectivitySmokeTest.ts`'s own doc
comment) as a one-shot `Job`, with a `ServiceAccount` and `ClusterRole`
scoped to exactly the verbs `cluster/kubernetes*.ts` needs.

This proves RBAC and in-cluster API-server reachability are correct —
it is **not** a running self-healing controller. See
`packages/xguard/Dockerfile`'s own comment and
`docs/XGUARD_INTEGRATION.md`'s "What's deferred" section for why no
such controller exists yet (no real telemetry adapter, no real
identity provider).

## Build the image

From the monorepo root (the chart's `image.repository`/`image.tag`
values must match):

```bash
docker build -f packages/xguard/Dockerfile -t xguard-ops:dev .
```

Not yet actually run in this environment — no Docker daemon is
available here (see the project's own Phase 0 gap analysis). The
`Dockerfile` has been reviewed line by line against the monorepo's
real workspace layout, but, like `cluster/kubernetesNodeCordoner.ts`'s
own tests, has not been proven by an actual `docker build` + `docker
run`.

## Install

```bash
helm install xguard-ops ./helm/xguard-ops \
  --set image.repository=xguard-ops \
  --set image.tag=dev
```

Optionally point the smoke test's read-only checks at real resources
(every one is skipped, not failed, if left unset):

```bash
helm install xguard-ops ./helm/xguard-ops \
  --set smokeTest.nodeName=node-7 \
  --set smokeTest.pod.namespace=clinic \
  --set smokeTest.pod.name=web-1 \
  --set smokeTest.pod.containerName=web \
  --set smokeTest.deployment.namespace=clinic \
  --set smokeTest.deployment.name=lab-worker
```

Then read the result:

```bash
kubectl logs job/xguard-ops-xguard-ops-smoke-test
```

Verified with `helm lint` and `helm template` (both pass, including
with `rbac.create=false` and every `smokeTest.*` value set) — not yet
with `helm install` against a real cluster, the same stated gap as the
image build above.
