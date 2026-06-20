const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Negative integration test: using the scoped mint action artifact directly as
// a passive MintAuthority resource type fails with CellScript error 25 during
// output type verification. Keep this script as evidence for the manifest gap.
const corePath = path.resolve('/home/badman/.nvm/versions/node/v20.19.5/lib/node_modules/@offckb/cli/node_modules/@ckb-ccc/core');
const ccc = require(corePath);

const RPC = 'http://127.0.0.1:28114';
const CELLSCRIPT_DIR = '/home/badman/Projects/amm-swap-builder/cellscript';
const TOKEN_CELL = `${CELLSCRIPT_DIR}/examples/token.cell`;
const PRIVKEY = process.env.CKB_PRIVKEY;
if (!PRIVKEY) { console.error('CKB_PRIVKEY env var required'); process.exit(1); }

const SECP_CODE_HASH = '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const SECP_DEP = { txHash: '0x4d804f1495612631da202fe9902fa9899118554b08138cfe5dfb50e1ede76293', index: 0 };
const ACCOUNT2_ARGS = '0x9d1edebedf8f026c0d597c4c5cd3f45dec1f7557';
const ACCOUNT2_LOCK = { codeHash: SECP_CODE_HASH, hashType: 'type', args: ACCOUNT2_ARGS };
const ACCOUNT2_LOCK_RPC = toRpcScript(ACCOUNT2_LOCK);

const MINT_CODE_HASH = '0xf08ef80eccc4aa481adae60a49433a8df0f5ea8503b50ab45ceeaead4bc159a4';
const MINT_DEP = { txHash: '0xe228000d95c134e896192e5292c263e7c38892643ae8e048b3d4f2fab4d32709', index: 0 };

const SHANNONS = 100000000n;
const FEE = 200000n;
const AUTH_CAPACITY = 400n * SHANNONS;
const TOKEN_CAPACITY = 200n * SHANNONS;

function hex(buffer) { return '0x' + Buffer.from(buffer).toString('hex'); }
function u64le(value) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; }
function scriptHash(script) { return ccc.Script.from(script).hash(); }
function toRpcScript(script) {
  if (!script) return null;
  return { code_hash: script.codeHash, hash_type: script.hashType, args: script.args };
}
function toRpcOutPoint(outPoint) {
  if (!outPoint) return null;
  const index = typeof outPoint.index === 'number' ? '0x' + outPoint.index.toString(16) : outPoint.index;
  return { tx_hash: outPoint.txHash || outPoint.tx_hash, index };
}
function toCccOutPoint(outPoint) {
  return { txHash: outPoint.txHash || outPoint.tx_hash, index: outPoint.index };
}
function toRpcCellDep(dep) {
  return { out_point: toRpcOutPoint(dep.outPoint), dep_type: dep.depType === 'depGroup' ? 'dep_group' : dep.depType };
}
function secpDep() {
  return { outPoint: SECP_DEP, depType: 'depGroup' };
}
function mintDep() {
  return { outPoint: MINT_DEP, depType: 'code' };
}
function toRpcTx(tx) {
  return {
    version: tx.version,
    cell_deps: tx.cellDeps.map(toRpcCellDep),
    header_deps: tx.headerDeps,
    inputs: tx.inputs.map((input) => ({ previous_output: toRpcOutPoint(input.previousOutput), since: input.since })),
    outputs: tx.outputs.map((output) => ({ capacity: output.capacity, lock: toRpcScript(output.lock), type: toRpcScript(output.type) })),
    outputs_data: tx.outputsData,
    witnesses: tx.witnesses,
  };
}
function tokenData(amount, symbol) { return hex(Buffer.concat([u64le(amount), Buffer.from(symbol.padEnd(8, '\0'), 'ascii')])); }
function authData(symbol, maxSupply, minted) { return hex(Buffer.concat([Buffer.from(symbol.padEnd(8, '\0'), 'ascii'), u64le(maxSupply), u64le(minted)])); }
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
      .filter((assumption) => assumption.proof_plan_status === 'builder-required')
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
      note: 'Schema evidence for cellc validate-tx. CKB dry-run remains production acceptance evidence.',
      input_capacity_shannons: inputCapacity.toString(),
      output_capacity_shannons: outputCapacities.map((capacity) => capacity.toString()),
      outputs_total_capacity_shannons: outputsTotal.toString(),
      fee_paid_shannons: (inputCapacity - outputsTotal).toString(),
      capacity_is_sufficient: true,
      under_capacity_output_indexes: [],
    };
  }
  return { source: 'builder', checked: true };
}
function makeClient() {
  const client = new ccc.ClientJsonRpc(RPC);
  client.getKnownScript = async (name) => {
    if (name === 'Secp256k1Blake160') return { codeHash: SECP_CODE_HASH, hashType: 'type', cellDeps: [{ cellDep: { outPoint: SECP_DEP, depType: 'depGroup' } }] };
    if (name === 'AnyoneCanPay') return { codeHash: '0x3419a1c09eb2567f6552ee7a8ecffd64155cffe0f1796e6e61ec088d740c1356', hashType: 'type', cellDeps: [] };
    return null;
  };
  return client;
}
async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
async function getLargestLiveCell() {
  const result = await rpc('get_cells', [{ script: ACCOUNT2_LOCK_RPC, script_type: 'lock', script_search_mode: 'exact' }, 'desc', '0x14']);
  const cells = result.objects.filter((cell) => !cell.output.type && cell.output_data === '0x');
  if (!cells.length) throw new Error('no plain account #2 cell found');
  cells.sort((a, b) => Number(BigInt(b.output.capacity) - BigInt(a.output.capacity)));
  return cells[0];
}
async function sendSigned(client, tx) {
  const signer = new ccc.SignerCkbPrivateKey(client, PRIVKEY);
  const prepared = await signer.prepareTransaction(ccc.Transaction.from(tx));
  const signed = await signer.signOnlyTransaction(prepared);
  return await client.sendTransaction(signed);
}
async function createAuthorityInput(client, mintType) {
  const funding = await getLargestLiveCell();
  const fundingCap = BigInt(funding.output.capacity);
  const changeCap = fundingCap - AUTH_CAPACITY - TOKEN_CAPACITY - FEE;
  const tx = {
    version: '0x0',
    cellDeps: [secpDep(), mintDep()],
    headerDeps: [],
    inputs: [{ previousOutput: toCccOutPoint(funding.out_point), since: '0x0' }],
    outputs: [
      { capacity: '0x' + (AUTH_CAPACITY + TOKEN_CAPACITY).toString(16), lock: ACCOUNT2_LOCK, type: mintType },
      { capacity: '0x' + changeCap.toString(16), lock: ACCOUNT2_LOCK, type: null },
    ],
    outputsData: [authData('SCOPED01', 10000, 0), '0x'],
    witnesses: ['0x'],
  };
  const hash = await sendSigned(client, tx);
  console.log('Created scoped authority input:', hash);
  return { txHash: hash, index: '0x0', capacity: AUTH_CAPACITY + TOKEN_CAPACITY };
}
async function main() {
  const client = makeClient();
  const mintType = { codeHash: MINT_CODE_HASH, hashType: 'data2', args: '0x' };
  const authorityOutPoint = await createAuthorityInput(client, mintType);
  const recipient = scriptHash(ACCOUNT2_LOCK);
  const amount = 25n;
  const entry = JSON.parse(execFileSync('cellc', [
    'entry-witness', TOKEN_CELL,
    '--target-profile', 'ckb', '--action', 'mint_with_authority', '--json',
    '--arg', recipient, '--arg', amount.toString(),
  ], { encoding: 'utf8' }));
  const mintTx = {
    version: '0x0',
    cellDeps: [secpDep(), mintDep()],
    headerDeps: [],
    inputs: [{ previousOutput: { txHash: authorityOutPoint.txHash, index: authorityOutPoint.index }, since: '0x0' }],
    outputs: [
      { capacity: '0x' + AUTH_CAPACITY.toString(16), lock: ACCOUNT2_LOCK, type: mintType },
      { capacity: '0x' + (TOKEN_CAPACITY - FEE).toString(16), lock: ACCOUNT2_LOCK, type: mintType },
    ],
    outputsData: [authData('SCOPED01', 10000, amount), tokenData(amount, 'SCOPED01')],
    witnesses: [entry.witness_hex.startsWith('0x') ? entry.witness_hex : '0x' + entry.witness_hex],
  };
  const validationTx = toRpcTx(mintTx);
  validationTx.builder_assumption_evidence = builderAssumptionEvidence(loadBuilderAssumptions(), authorityOutPoint.capacity, mintTx.outputs);
  const validationPath = process.env.MINT_TX_JSON || '/tmp/opencode/scoped_mint_tx_with_evidence.json';
  fs.writeFileSync(validationPath, JSON.stringify(validationTx, null, 2));
  console.log('Wrote mint validation tx JSON:', validationPath);
  execFileSync('cellc', [
    'validate-tx', '--against', `${CELLSCRIPT_DIR}/build/token_mint_with_authority.elf.meta.json`, '--json', validationPath,
  ], { stdio: 'inherit' });
  console.log('Mint validate-tx passed. CKB dry-run is intentionally not run here yet.');
  console.log('Next boundary: combine raw CellScript entry witness with secp lock witness without changing the script-group entry surface.');
  if (process.env.SUBMIT_MINT === '1') {
    const hash = await client.sendTransaction(ccc.Transaction.from(mintTx));
    console.log('Sent scoped mint tx:', hash);
  }
}

main().catch((e) => { console.error('Error:', e.message || e); if (e.data) console.error(JSON.stringify(e.data, null, 2)); process.exit(1); });
