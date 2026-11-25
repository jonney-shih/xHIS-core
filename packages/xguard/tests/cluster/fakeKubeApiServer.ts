import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { KubeConfig } from '@kubernetes/client-node';

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

export interface FakeKubeApiServer {
  readonly server: Server;
  readonly kubeConfig: KubeConfig;
  readonly requests: readonly RecordedRequest[];
  close(): Promise<void>;
}

/**
 * A bare HTTP server standing in for the Kubernetes API server, since
 * no real cluster is available to this workspace (see
 * `kubernetesNodeCordoner.test.ts`'s own doc comment for what tests
 * built on this do and don't prove: the exact HTTP call a
 * `@kubernetes/client-node` call produces -- method, path, body --
 * never RBAC, admission control, the scheduler, or any other real
 * cluster behavior).
 *
 * `responses` is keyed by exact `"<METHOD> <path>"`; every request
 * actually received is recorded verbatim in the returned `requests`
 * array, in arrival order, so a test can assert on it directly instead
 * of trusting the client library's own claim about what it sent.
 */
export async function startFakeKubeApiServer(
  responses: Readonly<Record<string, { readonly status: number; readonly body: unknown }>>,
): Promise<FakeKubeApiServer> {
  const requests: RecordedRequest[] = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw.length > 0 ? (JSON.parse(raw) as unknown) : undefined;
      requests.push({ method: req.method ?? '', url: req.url ?? '', body });

      const key = `${req.method} ${req.url}`;
      const matched = responses[key];
      if (!matched) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            kind: 'Status',
            status: 'Failure',
            code: 404,
            message: `fakeKubeApiServer: no response registered for "${key}"`,
          }),
        );
        return;
      }
      res.writeHead(matched.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(matched.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromClusterAndUser(
    { name: 'fake-cluster', server: url, skipTLSVerify: true },
    { name: 'fake-user' },
  );

  return {
    server,
    kubeConfig,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
