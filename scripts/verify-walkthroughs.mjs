// Throwaway, non-interactive verification for roleplay-cli.mjs's
// WALKTHROUGHS registry -- the multi-step counterpart to
// verify-roleplay-all12.mjs, same reason: piped stdin can't reliably
// drive readline past the first prompt, so this drives the real
// toPlanProposal -> Check -> resolveApprovalForProposal -> act() chain
// directly, once per step, threading the real committed context from
// one step into the next exactly the way runWalkthrough() does.
import { act, createInMemoryIdentityProvider, resolveApprovalForProposal, toPlanProposal } from '@xhis/core';
import { WALKTHROUGHS } from './roleplay-cli.mjs';

let failures = 0;

function assert(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${label}`);
  if (!condition) failures += 1;
}

for (const walkthrough of WALKTHROUGHS) {
  console.log(`\n--- ${walkthrough.key} ---`);
  const shell = walkthrough.createShell();
  let context = walkthrough.initialContext;

  for (const step of walkthrough.steps) {
    const label = `${walkthrough.key}: ${step.label}`;
    const rawInstruction = step.instruction(context);

    const proposalResult = toPlanProposal(
      walkthrough.validators,
      { instructions: [rawInstruction], rationale: step.label, modelVersion: 'v1', promptVersion: 'v1' },
      '2026-10-18T00:00:00.000Z',
    );
    assert(`${label}: instruction validates`, proposalResult.ok);
    if (!proposalResult.ok) break;
    const proposal = proposalResult.value;

    const decision = walkthrough.verifier.verify(proposal);
    assert(`${label}: Check needs-human-approval`, decision.kind === 'needs-human-approval');

    const tier = walkthrough.riskTiers[rawInstruction.kind];
    const allowedRole = walkthrough.approvalPolicy[tier][0];
    const provider = createInMemoryIdentityProvider([{ id: 'you', displayName: 'You', roles: [allowedRole] }]);
    const resolution = resolveApprovalForProposal(provider, walkthrough.riskTiers, walkthrough.approvalPolicy, proposal, {
      approverId: 'you',
      approved: true,
      decidedAt: '2026-10-18T00:00:00.000Z',
    });
    assert(`${label}: '${allowedRole}' resolves`, resolution.kind === 'resolved');
    if (resolution.kind !== 'resolved') break;

    const doOutcome = walkthrough.engine.executeSequence(context, proposal.instructions);
    assert(`${label}: Do succeeds`, doOutcome.ok);
    if (!doOutcome.ok) break;

    const outcome = await act(shell, {
      proposal,
      doOutcome,
      decision,
      baselineContext: context,
      reexecute: (ctx) => walkthrough.engine.executeSequence(ctx, proposal.instructions),
      approval: resolution.approval,
      recordedAt: '2026-10-18T00:00:00.000Z',
    });
    assert(`${label}: act() commits`, outcome === 'committed');
    if (outcome !== 'committed') break;

    context = (await shell.readLatest()) ?? context;
  }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exitCode = failures === 0 ? 0 : 1;
