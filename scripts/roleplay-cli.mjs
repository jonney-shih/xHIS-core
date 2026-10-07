#!/usr/bin/env node
// Interactive role-play walkthrough for xHIS -- all 9 real domains (the 8
// clinical ones plus the xguard ops domain). Pick one, see a real pending
// proposal and Check's real decision, log in as whichever role you want to
// try, approve or reject, and see act()'s real outcome. Everything here is
// the actual engine/validator/verifier/identity code, never a mock.
//
// The clinical domains deep-import @xhis/core's compiled dist/ for their
// domain-specific pieces, since those are deliberately *not* part of
// @xhis/core's own public surface (see that package's index.ts doc
// comment: the clinical domains are worked examples of the pattern, not
// reusable library code). The ops domain uses @xhis/xguard's public
// surface directly, since it *is* meant to be consumed that way.
//
// This is a plain runtime JS script, not TypeScript -- the branded ID
// types (BedId, LabOrderId, ...) have zero runtime effect, so context
// records below just use plain strings.
//
// Run with: node scripts/roleplay-cli.mjs

import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import {
  act,
  createInMemoryIdentityProvider,
  createInMemoryShell,
  isoTimestamp,
  resolveApprovalForProposal,
  toPlanProposal,
} from '@xhis/core';
import {
  createOpsShell,
  createInMemorySandboxProvisioner,
  opsEngine,
  opsInstructionValidators,
  opsRiskTiers,
  opsVerifier,
  EXAMPLE_opsApprovalPolicy,
} from '@xhis/xguard';

import { patientEngine } from '../packages/xhis-core/dist/instructions/patient/engine.js';
import { patientInstructionValidators } from '../packages/xhis-core/dist/agentic/validation/patient.js';
import { patientVerifier } from '../packages/xhis-core/dist/agentic/verification/patient.js';
import { patientRiskTiers } from '../packages/xhis-core/dist/agentic/risk/patient.js';
import { EXAMPLE_patientApprovalPolicy } from '../packages/xhis-core/dist/agentic/identity/patient.js';

import { bedEngine } from '../packages/xhis-core/dist/instructions/bed/engine.js';
import { bedInstructionValidators } from '../packages/xhis-core/dist/agentic/validation/bed.js';
import { bedVerifier } from '../packages/xhis-core/dist/agentic/verification/bed.js';
import { bedRiskTiers } from '../packages/xhis-core/dist/agentic/risk/bed.js';
import { EXAMPLE_bedApprovalPolicy } from '../packages/xhis-core/dist/agentic/identity/bed.js';

import { labEngine } from '../packages/xhis-core/dist/instructions/lab/engine.js';
import { labInstructionValidators } from '../packages/xhis-core/dist/agentic/validation/lab.js';
import { labVerifier } from '../packages/xhis-core/dist/agentic/verification/lab.js';
import { labRiskTiers } from '../packages/xhis-core/dist/agentic/risk/lab.js';
import { EXAMPLE_labApprovalPolicy } from '../packages/xhis-core/dist/agentic/identity/lab.js';

import { pharmacyEngine } from '../packages/xhis-core/dist/instructions/pharmacy/engine.js';
import { pharmacyInstructionValidators } from '../packages/xhis-core/dist/agentic/validation/pharmacy.js';
import { pharmacyVerifier } from '../packages/xhis-core/dist/agentic/verification/pharmacy.js';
import { pharmacyRiskTiers } from '../packages/xhis-core/dist/agentic/risk/pharmacy.js';
import { EXAMPLE_pharmacyApprovalPolicy } from '../packages/xhis-core/dist/agentic/identity/pharmacy.js';

import { schedulingEngine } from '../packages/xhis-core/dist/instructions/scheduling/engine.js';
import { schedulingInstructionValidators } from '../packages/xhis-core/dist/agentic/validation/scheduling.js';
import { schedulingVerifier } from '../packages/xhis-core/dist/agentic/verification/scheduling.js';
import { schedulingRiskTiers } from '../packages/xhis-core/dist/agentic/risk/scheduling.js';
import { EXAMPLE_schedulingApprovalPolicy } from '../packages/xhis-core/dist/agentic/identity/scheduling.js';

import { ledgerEngine } from '../packages/xhis-core/dist/instructions/ledger/engine.js';
import { ledgerInstructionValidators } from '../packages/xhis-core/dist/agentic/validation/ledger.js';
import { ledgerVerifier } from '../packages/xhis-core/dist/agentic/verification/ledger.js';
import { ledgerRiskTiers } from '../packages/xhis-core/dist/agentic/risk/ledger.js';
import { EXAMPLE_ledgerApprovalPolicy } from '../packages/xhis-core/dist/agentic/identity/ledger.js';

import { imagingEngine } from '../packages/xhis-core/dist/instructions/imaging/engine.js';
import { imagingInstructionValidators } from '../packages/xhis-core/dist/agentic/validation/imaging.js';
import { imagingVerifier } from '../packages/xhis-core/dist/agentic/verification/imaging.js';
import { imagingRiskTiers } from '../packages/xhis-core/dist/agentic/risk/imaging.js';
import { EXAMPLE_imagingApprovalPolicy } from '../packages/xhis-core/dist/agentic/identity/imaging.js';

import { nursingEngine } from '../packages/xhis-core/dist/instructions/nursing/engine.js';
import { nursingInstructionValidators } from '../packages/xhis-core/dist/agentic/validation/nursing.js';
import { nursingVerifier } from '../packages/xhis-core/dist/agentic/verification/nursing.js';
import { nursingRiskTiers } from '../packages/xhis-core/dist/agentic/risk/nursing.js';
import { EXAMPLE_nursingApprovalPolicy } from '../packages/xhis-core/dist/agentic/identity/nursing.js';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (question) => rl.question(question);
const line = () => console.log('─'.repeat(72));

const AT = isoTimestamp('2026-10-07T00:00:00.000Z');

/**
 * One entry per real domain. `tier` names which of the proposal's own
 * risk-tier approver lists to show -- it's a property of the chosen
 * instruction (`AssignBed`/`CordonNode` are at different tiers than the
 * rest), not something this script decides; every tier/role pair here
 * is copied verbatim from that domain's own `agentic/risk/*.ts` and
 * `agentic/identity/*.ts`.
 */
export const SCENARIOS = [
  {
    key: 'patient',
    describe: "Recommending DischargePatient(encounter-1) for an admitted encounter.",
    tier: 'approval-required',
    engine: patientEngine,
    validators: patientInstructionValidators,
    verifier: patientVerifier,
    riskTiers: patientRiskTiers,
    approvalPolicy: EXAMPLE_patientApprovalPolicy,
    buildContext: () => ({
      encounters: { 'encounter-1': { encounterId: 'encounter-1', patientId: 'patient-1', status: 'admitted', admittedAt: AT } },
    }),
    rawInstruction: () => ({ kind: 'DischargePatient', encounterId: 'encounter-1', dischargedAt: AT }),
    createShell: () => createInMemoryShell(),
    describeResult: (shell) => `encounter-1 status is now: ${shell.commits.at(-1).context.encounters['encounter-1'].status}`,
  },
  {
    key: 'bed',
    describe: 'Recommending AssignBed(bed-1, encounter-1) for an available bed.',
    tier: 'review-required',
    engine: bedEngine,
    validators: bedInstructionValidators,
    verifier: bedVerifier,
    riskTiers: bedRiskTiers,
    approvalPolicy: EXAMPLE_bedApprovalPolicy,
    buildContext: () => ({ beds: { 'bed-1': { bedId: 'bed-1', status: 'available' } } }),
    rawInstruction: () => ({ kind: 'AssignBed', bedId: 'bed-1', encounterId: 'encounter-1', assignedAt: AT }),
    createShell: () => createInMemoryShell(),
    describeResult: (shell) => `bed-1 status is now: ${shell.commits.at(-1).context.beds['bed-1'].status}`,
  },
  {
    key: 'lab',
    describe: 'Recommending ReportLabResult(order-1) for an ordered lab test.',
    tier: 'approval-required',
    engine: labEngine,
    validators: labInstructionValidators,
    verifier: labVerifier,
    riskTiers: labRiskTiers,
    approvalPolicy: EXAMPLE_labApprovalPolicy,
    buildContext: () => ({
      orders: { 'order-1': { orderId: 'order-1', encounterId: 'encounter-1', testCode: 'CBC', status: 'ordered', orderedAt: AT } },
    }),
    rawInstruction: () => ({ kind: 'ReportLabResult', orderId: 'order-1', result: 'WBC 7.2', resultedAt: AT }),
    createShell: () => createInMemoryShell(),
    describeResult: (shell) => `order-1 status is now: ${shell.commits.at(-1).context.orders['order-1'].status}`,
  },
  {
    key: 'pharmacy',
    describe: 'Recommending DispenseMedication(prescription-1) for a prescribed medication.',
    tier: 'approval-required',
    engine: pharmacyEngine,
    validators: pharmacyInstructionValidators,
    verifier: pharmacyVerifier,
    riskTiers: pharmacyRiskTiers,
    approvalPolicy: EXAMPLE_pharmacyApprovalPolicy,
    buildContext: () => ({
      prescriptions: {
        'prescription-1': { prescriptionId: 'prescription-1', encounterId: 'encounter-1', medicationCode: 'AMOX500', status: 'prescribed', prescribedAt: AT },
      },
    }),
    rawInstruction: () => ({ kind: 'DispenseMedication', prescriptionId: 'prescription-1', dispensedAt: AT }),
    createShell: () => createInMemoryShell(),
    describeResult: (shell) => `prescription-1 status is now: ${shell.commits.at(-1).context.prescriptions['prescription-1'].status}`,
  },
  {
    key: 'scheduling',
    describe: 'Recommending CancelBooking(booking-1) for a scheduled OR booking.',
    tier: 'approval-required',
    engine: schedulingEngine,
    validators: schedulingInstructionValidators,
    verifier: schedulingVerifier,
    riskTiers: schedulingRiskTiers,
    approvalPolicy: EXAMPLE_schedulingApprovalPolicy,
    buildContext: () => ({
      bookings: { 'booking-1': { bookingId: 'booking-1', resourceId: 'or-1', subjectId: 'encounter-1', startAt: AT, endAt: AT, status: 'scheduled' } },
    }),
    rawInstruction: () => ({ kind: 'CancelBooking', bookingId: 'booking-1', cancelledAt: AT }),
    createShell: () => createInMemoryShell(),
    describeResult: (shell) => `booking-1 status is now: ${shell.commits.at(-1).context.bookings['booking-1'].status}`,
  },
  {
    key: 'ledger',
    describe: 'Recommending ReverseEntry(entry-1) for a posted ledger entry.',
    tier: 'approval-required',
    engine: ledgerEngine,
    validators: ledgerInstructionValidators,
    verifier: ledgerVerifier,
    riskTiers: ledgerRiskTiers,
    approvalPolicy: EXAMPLE_ledgerApprovalPolicy,
    buildContext: () => ({
      accounts: {},
      entries: {
        'entry-1': {
          entryId: 'entry-1',
          lines: [
            { accountId: 'accounts-receivable', direction: 'debit', amount: 100 },
            { accountId: 'cash', direction: 'credit', amount: 100 },
          ],
          memo: 'role-play demo',
          status: 'posted',
          postedAt: AT,
        },
      },
    }),
    rawInstruction: () => ({ kind: 'ReverseEntry', entryId: 'entry-1', reversedAt: AT }),
    createShell: () => createInMemoryShell(),
    describeResult: (shell) => `entry-1 status is now: ${shell.commits.at(-1).context.entries['entry-1'].status}`,
  },
  {
    key: 'imaging',
    describe: 'Recommending ReportStudy(study-1) for a performed imaging study.',
    tier: 'approval-required',
    engine: imagingEngine,
    validators: imagingInstructionValidators,
    verifier: imagingVerifier,
    riskTiers: imagingRiskTiers,
    approvalPolicy: EXAMPLE_imagingApprovalPolicy,
    buildContext: () => ({
      studies: { 'study-1': { studyId: 'study-1', encounterId: 'encounter-1', modality: 'CT', status: 'performed', orderedAt: AT, performedAt: AT } },
    }),
    rawInstruction: () => ({ kind: 'ReportStudy', studyId: 'study-1', reportText: 'No acute findings.', reportedAt: AT }),
    createShell: () => createInMemoryShell(),
    describeResult: (shell) => `study-1 status is now: ${shell.commits.at(-1).context.studies['study-1'].status}`,
  },
  {
    key: 'nursing',
    describe: 'Recommending GrantRole(grant-1) backed by an active, unexpired credential.',
    tier: 'approval-required',
    engine: nursingEngine,
    validators: nursingInstructionValidators,
    verifier: nursingVerifier,
    riskTiers: nursingRiskTiers,
    approvalPolicy: EXAMPLE_nursingApprovalPolicy,
    buildContext: () => ({
      credentials: {
        'credential-1': { credentialId: 'credential-1', staffId: 'staff-1', credentialType: 'RN-license', status: 'active', issuedAt: AT, expiresAt: '2030-01-01T00:00:00.000Z' },
      },
      roleGrants: {},
    }),
    rawInstruction: () => ({ kind: 'GrantRole', grantId: 'grant-1', staffId: 'staff-1', role: 'charge-nurse', credentialId: 'credential-1', grantedAt: AT }),
    createShell: () => createInMemoryShell(),
    describeResult: (shell) => `grant-1 is now recorded: ${JSON.stringify(shell.commits.at(-1).effects[0])}`,
  },
  {
    key: 'ops',
    describe: 'Recommending CordonNode(node-7) from a sustained MemoryPressure signal.',
    tier: 'approval-required',
    engine: opsEngine,
    validators: opsInstructionValidators,
    verifier: opsVerifier,
    riskTiers: opsRiskTiers,
    approvalPolicy: EXAMPLE_opsApprovalPolicy,
    buildContext: () => ({ sandboxes: {} }),
    rawInstruction: () => ({ kind: 'CordonNode', nodeId: 'node-7', requestedAt: AT }),
    createShell: () => createOpsShell(createInMemorySandboxProvisioner()),
    describeResult: (shell) => `Recorded effects: ${JSON.stringify(shell.commits.at(-1).effects)} (no real K8s action fires yet)`,
  },
];

export async function roleplayApproval({ label, decision, allowedRoles, resolveApprovalFn }) {
  console.log(`\nCheck's real decision: ${decision.kind}`);
  if (decision.reasons?.length) console.log(`Reasons: ${decision.reasons.join('; ')}`);
  console.log(`Roles actually permitted to approve this tier: ${allowedRoles.join(', ')}`);

  for (;;) {
    const role = (await ask(`\n[${label}] What role are you logging in as? `)).trim();
    const approvedRaw = (await ask(`Approve as '${role}'? (y/n) `)).trim().toLowerCase();
    const approved = approvedRaw === 'y' || approvedRaw === 'yes';

    const resolution = resolveApprovalFn(role, approved);

    if (resolution.kind === 'unresolved') {
      console.log(`\n✗ Unresolved — the system correctly refused: ${resolution.reasons?.join('; ') ?? '(no identity for that role/id)'}`);
      const retry = (await ask('Try a different role? (y/n) ')).trim().toLowerCase();
      if (retry === 'y' || retry === 'yes') continue;
      return { resolved: false };
    }

    console.log(`\n✓ Resolved — approverRole='${resolution.approval.approverRole}', approved=${resolution.approval.approved}`);
    return { resolved: true, approval: resolution.approval };
  }
}

async function runScenario(scenario) {
  line();
  console.log(`SCENARIO — ${scenario.key}`);
  line();
  console.log(`\n${scenario.describe}`);

  const context = scenario.buildContext();
  const proposalResult = toPlanProposal(
    scenario.validators,
    { instructions: [scenario.rawInstruction()], rationale: 'role-play demo', modelVersion: 'roleplay-cli-v1', promptVersion: 'roleplay-cli-v1' },
    AT,
  );
  if (!proposalResult.ok) {
    console.error('Validation failed:', proposalResult.error);
    return;
  }
  const proposal = proposalResult.value;
  const decision = scenario.verifier.verify(proposal);

  const { resolved, approval } = await roleplayApproval({
    label: scenario.key,
    decision,
    allowedRoles: scenario.approvalPolicy[scenario.tier],
    resolveApprovalFn: (role, approved) => {
      const provider = createInMemoryIdentityProvider([{ id: 'you', displayName: 'You', roles: [role] }]);
      return resolveApprovalForProposal(provider, scenario.riskTiers, scenario.approvalPolicy, proposal, {
        approverId: 'you',
        approved,
        decidedAt: AT,
      });
    },
  });

  const doOutcome = scenario.engine.executeSequence(context, proposal.instructions);
  const shell = scenario.createShell();
  const outcome = act(shell, {
    proposal,
    doOutcome,
    decision,
    baselineContext: context,
    reexecute: (ctx) => scenario.engine.executeSequence(ctx, proposal.instructions),
    approval: resolved ? approval : undefined,
    recordedAt: AT,
  });

  console.log(`\nAct's real outcome: ${outcome}`);
  if (outcome === 'committed') {
    console.log(scenario.describeResult(shell));
  }
}

async function main() {
  console.log('xHIS role-play walkthrough — real engine/validator/verifier/identity code, no mocks.');

  for (;;) {
    line();
    console.log('Pick a domain to role-play:');
    SCENARIOS.forEach((s, i) => console.log(`  ${i + 1}. ${s.key}`));
    console.log('  q. quit');

    const choice = (await ask('\n> ')).trim().toLowerCase();
    if (choice === 'q' || choice === 'quit') break;

    const index = Number.parseInt(choice, 10) - 1;
    const scenario = SCENARIOS[index];
    if (!scenario) {
      console.log('Not a valid choice — pick a number from the list, or q to quit.');
      continue;
    }

    await runScenario(scenario);
  }

  line();
  console.log('Done.');
  rl.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
