import { describe, expect, it } from 'vitest';
import { MalformedResourceIdError, parseNamespacedName, parseNamespacedPodContainerRef } from '../../src/cluster/resourceRef.js';

describe('parseNamespacedName', () => {
  it('splits "<namespace>/<name>" into its two parts', () => {
    expect(parseNamespacedName('DeploymentId', 'clinic/lab-worker')).toEqual({
      namespace: 'clinic',
      name: 'lab-worker',
    });
  });

  it.each(['lab-worker', 'clinic/', '/lab-worker', 'clinic/lab/worker'])(
    'rejects %j as malformed',
    (value) => {
      expect(() => parseNamespacedName('DeploymentId', value)).toThrow(MalformedResourceIdError);
    },
  );
});

describe('parseNamespacedPodContainerRef', () => {
  it('splits "<namespace>/<podName>/<containerName>" into its three parts', () => {
    expect(parseNamespacedPodContainerRef('ContainerId', 'clinic/web-7f9c-abc12/web')).toEqual({
      namespace: 'clinic',
      podName: 'web-7f9c-abc12',
      containerName: 'web',
    });
  });

  it.each(['clinic/web-7f9c-abc12', 'clinic//web', 'clinic/web-7f9c-abc12/web/extra'])(
    'rejects %j as malformed',
    (value) => {
      expect(() => parseNamespacedPodContainerRef('ContainerId', value)).toThrow(MalformedResourceIdError);
    },
  );
});
