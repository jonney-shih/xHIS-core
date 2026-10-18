// Throwaway, non-interactive verification for roleplay-cli.mjs's
// SCENARIOS registry -- proves the real toPlanProposal -> Check ->
// resolveApprovalForProposal -> act() chain actually commits for an
// authorized role, and is correctly refused for an unauthorized one,
// across all 12 domains (the 11 clinical ones plus ops). Bypasses
// readline entirely (see roleplay-cli.mjs's own note on why piped
// stdin can't drive its interactive prompts). Previously
// verify-roleplay-all9.mjs, renamed once outpatient/inpatient/
// emergency brought the real domain count to 12 -- this file's own
// logic is, and always was, fully generic over SCENARIOS; only the
// name and this comment ever hardcoded a count.
import { act, createInMemoryIdentityProvider, resolveApprovalForProposal, toPlanProposal } from '@xhis/core';
import { SCENARIOS } from './roleplay-cli.mjs';

const UNAUTHORIZED_ROLE = 'definitely-not-a-real-role';
let failures = 0;

function assert(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${label}`);
  if (!condition) failures += 1;
}

for (const scenario of SCENARIOS) {
  const context = scenario.buildContext();
  const proposalResult = toPlanProposal(
    scenario.validators,
    { instructions: [scenario.rawInstruction()], rationale: 'verify', modelVersion: 'v1', promptVersion: 'v1' },
    '2026-10-07T00:00:00.000Z',
  );
  assert(`${scenario.key}: raw instruction validates`, proposalResult.ok);
  if (!proposalResult.ok) continue;
  const proposal = proposalResult.value;

  const decision = scenario.verifier.verify(proposal);
  assert(`${scenario.key}: Check needs-human-approval at '${scenario.tier}'`, decision.kind === 'needs-human-approval');

  const wrongProvider = createInMemoryIdentityProvider([{ id: 'you', displayName: 'You', roles: [UNAUTHORIZED_ROLE] }]);
  const wrongRes = resolveApprovalForProposal(wrongProvider, scenario.riskTiers, scenario.approvalPolicy, proposal, {
    approverId: 'you',
    approved: true,
    decidedAt: '2026-10-07T00:00:00.000Z',
  });
  assert(`${scenario.key}: an unauthorized role is correctly unresolved`, wrongRes.kind === 'unresolved');

  const allowedRole = scenario.approvalPolicy[scenario.tier][0];
  const rightProvider = createInMemoryIdentityProvider([{ id: 'you', displayName: 'You', roles: [allowedRole] }]);
  const rightRes = resolveApprovalForProposal(rightProvider, scenario.riskTiers, scenario.approvalPolicy, proposal, {
    approverId: 'you',
    approved: true,
    decidedAt: '2026-10-07T00:00:00.000Z',
  });
  assert(`${scenario.key}: '${allowedRole}' resolves`, rightRes.kind === 'resolved');
  if (rightRes.kind !== 'resolved') continue;

  const doOutcome = scenario.engine.executeSequence(context, proposal.instructions);
  assert(`${scenario.key}: Do succeeds against the seeded context`, doOutcome.ok);
  if (!doOutcome.ok) continue;

  const shell = scenario.createShell();
  const outcome = await act(shell, {
    proposal,
    doOutcome,
    decision,
    baselineContext: context,
    reexecute: (ctx) => scenario.engine.executeSequence(ctx, proposal.instructions),
    approval: rightRes.approval,
    recordedAt: '2026-10-07T00:00:00.000Z',
  });
  assert(`${scenario.key}: act() commits with an authorized approval`, outcome === 'committed');
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exitCode = failures === 0 ? 0 : 1;
