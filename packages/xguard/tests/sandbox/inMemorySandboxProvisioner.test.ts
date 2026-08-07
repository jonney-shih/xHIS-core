import { describe, expect, it } from 'vitest';
import { createInMemorySandboxProvisioner } from '../../src/sandbox/inMemorySandboxProvisioner.js';
import { sandboxId } from '../../src/instructions/ids.js';

describe('in-memory sandbox provisioner', () => {
  it('reports unknown for a sandbox it has never heard of', () => {
    const provisioner = createInMemorySandboxProvisioner();
    expect(provisioner.getStatus(sandboxId('sandbox-1'))).toEqual({ sandboxId: 'sandbox-1', state: 'unknown' });
  });

  it('records a reprovision call and updates status to reprovisioning', () => {
    const provisioner = createInMemorySandboxProvisioner([{ sandboxId: sandboxId('sandbox-1'), state: 'ready' }]);

    provisioner.reprovision(sandboxId('sandbox-1'));

    expect(provisioner.reprovisionCalls).toEqual(['sandbox-1']);
    expect(provisioner.getStatus(sandboxId('sandbox-1'))).toEqual({ sandboxId: 'sandbox-1', state: 'reprovisioning' });
  });
});
