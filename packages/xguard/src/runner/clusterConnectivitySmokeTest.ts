import { CoreV1Api, KubeConfig } from '@kubernetes/client-node';
import { createKubernetesContainerRestarter } from '../cluster/kubernetesContainerRestarter.js';
import { createKubernetesDeploymentScaler } from '../cluster/kubernetesDeploymentScaler.js';
import { createKubernetesNodeCordoner } from '../cluster/kubernetesNodeCordoner.js';
import { containerId, deploymentId, nodeId } from '../instructions/ids.js';

/**
 * This is what the container image this package's `Dockerfile` builds
 * actually runs — and it is deliberately *not* a self-healing
 * controller. `docs/XGUARD_INTEGRATION.md`'s "What's deferred" section
 * is explicit about why none exists yet: no real telemetry adapter
 * translates actual cluster signals into `TelemetryEvent`s, and no
 * real `IdentityProvider` exists for resolving human approvals outside
 * a test fixture. Building a reconciliation loop ahead of either would
 * mean inventing both, the same premature-abstraction mistake this
 * codebase's own history already avoids (see
 * `docs/DETERMINISTIC_CORE_PATTERN.md`).
 *
 * What this *does* prove, for real, the first time any code in this
 * package runs inside an actual cluster: that the `ServiceAccount`
 * `helm/xguard-ops` grants this pod has correctly-scoped RBAC to read
 * nodes, pods, and deployments, and that in-cluster API-server
 * reachability and authentication both work. That is exactly the
 * Phase 0 gap this closes — "the K8s client code is written and unit
 * tested against a fake API server" versus "it was actually run
 * against a real cluster" — nothing more. Every call below is
 * read-only (`getStatus`, never `cordon`/`restart`/`scale`) on
 * purpose: a smoke test that mutates cluster state on every pod start
 * would be its own hazard.
 *
 * `NODE_SMOKE_TEST_NODE_NAME`/`_POD_NAMESPACE`+`_POD_NAME`+
 * `_CONTAINER_NAME`/`_DEPLOYMENT_NAMESPACE`+`_DEPLOYMENT_NAME` are all
 * optional — when unset, that resource's check is skipped (reported,
 * not failed), since this smoke test has no business assuming any
 * specific resource exists in whatever cluster it's deployed to. The
 * one check that always runs, `listNode`, only needs cluster-scoped
 * `list` on `nodes` — true in effectively every RBAC setup that would
 * ever run this image at all — so there is always at least one real
 * signal either way.
 */
async function main(): Promise<void> {
  const kubeConfig = new KubeConfig();
  try {
    kubeConfig.loadFromCluster();
  } catch {
    // Not running inside a pod (no service-account token file) --
    // fall back to the caller's own kubeconfig, for running this
    // smoke test by hand against a real or local cluster during
    // development. A real in-cluster run always takes the try branch.
    kubeConfig.loadFromDefault();
  }

  const results: { readonly check: string; readonly outcome: 'ok' | 'skipped' | 'failed'; readonly detail: string }[] = [];

  try {
    const core = kubeConfig.makeApiClient(CoreV1Api);
    const nodes = await core.listNode();
    results.push({ check: 'listNode', outcome: 'ok', detail: `${nodes.items.length} node(s) visible` });
  } catch (error) {
    results.push({ check: 'listNode', outcome: 'failed', detail: String(error) });
  }

  const nodeName = process.env['NODE_SMOKE_TEST_NODE_NAME'];
  if (nodeName) {
    try {
      const status = await createKubernetesNodeCordoner(kubeConfig).getStatus(nodeId(nodeName));
      results.push({ check: `NodeCordoner.getStatus(${nodeName})`, outcome: 'ok', detail: JSON.stringify(status) });
    } catch (error) {
      results.push({ check: `NodeCordoner.getStatus(${nodeName})`, outcome: 'failed', detail: String(error) });
    }
  } else {
    results.push({ check: 'NodeCordoner.getStatus', outcome: 'skipped', detail: 'NODE_SMOKE_TEST_NODE_NAME unset' });
  }

  const podNamespace = process.env['NODE_SMOKE_TEST_POD_NAMESPACE'];
  const podName = process.env['NODE_SMOKE_TEST_POD_NAME'];
  const containerName = process.env['NODE_SMOKE_TEST_CONTAINER_NAME'];
  if (podNamespace && podName && containerName) {
    const ref = containerId(`${podNamespace}/${podName}/${containerName}`);
    try {
      const status = await createKubernetesContainerRestarter(kubeConfig).getStatus(ref);
      results.push({ check: `ContainerRestarter.getStatus(${ref})`, outcome: 'ok', detail: JSON.stringify(status) });
    } catch (error) {
      results.push({ check: `ContainerRestarter.getStatus(${ref})`, outcome: 'failed', detail: String(error) });
    }
  } else {
    results.push({
      check: 'ContainerRestarter.getStatus',
      outcome: 'skipped',
      detail: 'NODE_SMOKE_TEST_POD_NAMESPACE/_POD_NAME/_CONTAINER_NAME unset',
    });
  }

  const deploymentNamespace = process.env['NODE_SMOKE_TEST_DEPLOYMENT_NAMESPACE'];
  const deploymentName = process.env['NODE_SMOKE_TEST_DEPLOYMENT_NAME'];
  if (deploymentNamespace && deploymentName) {
    const ref = deploymentId(`${deploymentNamespace}/${deploymentName}`);
    try {
      const status = await createKubernetesDeploymentScaler(kubeConfig).getStatus(ref);
      results.push({ check: `DeploymentScaler.getStatus(${ref})`, outcome: 'ok', detail: JSON.stringify(status) });
    } catch (error) {
      results.push({ check: `DeploymentScaler.getStatus(${ref})`, outcome: 'failed', detail: String(error) });
    }
  } else {
    results.push({
      check: 'DeploymentScaler.getStatus',
      outcome: 'skipped',
      detail: 'NODE_SMOKE_TEST_DEPLOYMENT_NAMESPACE/_DEPLOYMENT_NAME unset',
    });
  }

  for (const result of results) {
    console.log(`[${result.outcome.toUpperCase()}] ${result.check}: ${result.detail}`);
  }

  if (results.some((result) => result.outcome === 'failed')) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('clusterConnectivitySmokeTest crashed:', error);
  process.exitCode = 1;
});
