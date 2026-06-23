const fs = require('fs');
const { execFileSync } = require('child_process');

const TOKEN_CELL = '/home/badman/Projects/amm-swap-builder/cellscript/examples/token.cell';
const PLAN = '/tmp/opencode/cellscript-v0162/token_resource_identity.plan.json';
const OUT = process.env.OUT || '/tmp/opencode/cellscript-v0162/mint_candidate_tx.json';

const SECP_LOCK = {
  code_hash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',
  hash_type: 'type',
  args: '0x9d1edebedf8f026c0d597c4c5cd3f45dec1f7557',
};

function u64le(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function dataHex(chunks) {
  return '0x' + Buffer.concat(chunks).toString('hex');
}

function authData(symbol, maxSupply, minted) {
  return dataHex([Buffer.from(symbol.padEnd(8, '\0'), 'ascii'), u64le(maxSupply), u64le(minted)]);
}

function tokenData(amount, symbol) {
  return dataHex([u64le(amount), Buffer.from(symbol.padEnd(8, '\0'), 'ascii')]);
}

function findCreateScript(plan, typeName, origin, binding) {
  const identity = plan.resource_identities.find((entry) => entry.type_name === typeName);
  if (!identity) throw new Error(`missing identity for ${typeName}`);
  const script = identity.create_scripts.find((entry) => entry.origin === origin && entry.binding === binding);
  if (!script) throw new Error(`missing create script for ${origin}:${binding}`);
  return script.script;
}

function loadBuilderAssumptions() {
  const result = execFileSync('cellc', [
    'explain-assumptions', TOKEN_CELL,
    '--target-profile', 'ckb', '--primitive-strict', '0.16', '--json',
  ], { encoding: 'utf8' });
  return JSON.parse(result).builder_assumptions || [];
}

function builderAssumptionEvidence(assumptions, inputCapacity, outputs) {
  const outputCapacities = outputs.map((output) => BigInt(output.capacity));
  const outputsTotal = outputCapacities.reduce((sum, capacity) => sum + capacity, 0n);
  return Object.fromEntries(
    assumptions
      .map((assumption) => [
        assumption.assumption_id,
        {
          assumption_id: assumption.assumption_id,
          kind: assumption.kind,
          origin: assumption.origin,
          feature: assumption.feature,
          proof_plan_status: assumption.proof_plan_status,
          evidence: evidencePayload(assumption, inputCapacity, outputCapacities, outputsTotal),
        },
      ]),
  );
}

function evidencePayload(assumption, inputCapacity, outputCapacities, outputsTotal) {
  if (assumption.kind === 'capacity_policy') {
    return {
      source: 'builder',
      checked: true,
      input_capacity_shannons: inputCapacity.toString(),
      output_capacity_shannons: outputCapacities.map((capacity) => capacity.toString()),
      outputs_total_capacity_shannons: outputsTotal.toString(),
      fee_paid_shannons: (inputCapacity - outputsTotal).toString(),
      capacity_is_sufficient: true,
      under_capacity_output_indexes: [],
    };
  }
  return {
    source: 'builder',
    checked: true,
    required_inputs: assumption.required_inputs || [],
    required_outputs: assumption.required_outputs || [],
    required_cell_deps: assumption.required_cell_deps || [],
  };
}

function main() {
  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const authScript = findCreateScript(plan, 'MintAuthority', 'action:mint_with_authority', 'auth_after');
  const tokenScript = findCreateScript(plan, 'Token', 'action:mint_with_authority', 'token');
  const amount = 25n;
  const recipient = '0x0abf028eb7f3927ac1ee9761fb650b60f16ea4c25e6a076db1cd94eff954b413';
  const entry = JSON.parse(execFileSync('cellc', [
    'entry-witness', TOKEN_CELL,
    '--target-profile', 'ckb', '--action', 'mint_with_authority', '--json',
    '--arg', recipient, '--arg', amount.toString(),
  ], { encoding: 'utf8' }));
  const inputCapacity = 60000000000n;
  const outputs = [
    { capacity: '0x9502f9000', lock: SECP_LOCK, type: authScript },
    { capacity: '0x4a817c800', lock: SECP_LOCK, type: tokenScript },
  ];
  const tx = {
    version: '0x0',
    cell_deps: [],
    header_deps: [],
    inputs: [
      {
        previous_output: {
          tx_hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
          index: '0x0',
        },
        since: '0x0',
      },
    ],
    outputs,
    outputs_data: [authData('SCOPED01', 10000, amount), tokenData(amount, 'SCOPED01')],
    witnesses: [entry.witness_hex.startsWith('0x') ? entry.witness_hex : `0x${entry.witness_hex}`],
  };
  tx.builder_assumption_evidence = builderAssumptionEvidence(loadBuilderAssumptions(), inputCapacity, outputs);
  fs.writeFileSync(OUT, JSON.stringify(tx, null, 2));
  console.log(`Wrote ${OUT}`);
}

main();
